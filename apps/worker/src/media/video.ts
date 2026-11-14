import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { rename } from 'node:fs/promises';

const exec = promisify(execFile);

/** Проверяет, доступен ли системный ffmpeg. */
export async function isFfmpegAvailable(): Promise<boolean> {
  try {
    await exec('ffmpeg', ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export interface VideoResult {
  durationMs: number;
  width: number;
  height: number;
  /** Пути к дополнительным вариантам (poster, webm и т. д.) */
  variants: Record<string, string>;
}

async function probeVideo(filePath: string): Promise<{ width: number; height: number; durationMs: number }> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'quiet', '-print_format', 'json', '-show_streams', filePath,
  ]);
  const info = JSON.parse(stdout) as {
    streams: Array<{ codec_type: string; width?: number; height?: number; duration?: string }>;
  };
  const v = info.streams.find((s) => s.codec_type === 'video');
  return {
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    durationMs: Math.round(parseFloat(v?.duration ?? '0') * 1000),
  };
}

/**
 * TS-20 · B-03: Конвертирует GIF → MP4 (заменяет оригинальный файл) + постер, опционально WebM.
 * Оригинальный GIF-файл атомарно заменяется MP4-версией (вредоносная нагрузка не выживает).
 */
export async function processGif(filePath: string, mediaId: string): Promise<VideoResult> {
  const dir = path.dirname(filePath);
  const tmpMp4 = path.join(dir, `${mediaId}_tmp_mp4`);
  const posterPath = path.join(dir, `${mediaId}_poster.jpg`);
  const webmPath = path.join(dir, `${mediaId}.webm`);

  // GIF → MP4 (H.264, faststart, yuv420p с выравниванием размеров до чётных значений)
  await exec('ffmpeg', [
    '-i', filePath,
    '-movflags', 'faststart',
    '-pix_fmt', 'yuv420p',
    '-b:v', '0',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    // Временный файл без расширения: контейнер задаётся явно, иначе ffmpeg не выберет формат и файл будет отклонён.
    '-f', 'mp4',
    '-y', tmpMp4,
  ]);

  // Первый кадр как постер
  await exec('ffmpeg', [
    '-i', filePath,
    '-vframes', '1',
    '-q:v', '3',
    '-y', posterPath,
  ]);

  // WebM (VP9) — пропускаем, если libvpx-vp9 недоступен
  let hasWebm = false;
  try {
    await exec('ffmpeg', [
      '-i', filePath,
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', '33',
      '-y', webmPath,
    ]);
    hasWebm = true;
  } catch {
    // libvpx-vp9 недоступен
  }

  // Атомарно заменяем GIF на MP4
  await rename(tmpMp4, filePath);

  const info = await probeVideo(filePath);
  const variants: Record<string, string> = { poster: posterPath };
  if (hasWebm) variants['webm'] = webmPath;

  return { ...info, variants };
}

/** Потолок высоты видео по умолчанию (все тарифы, кроме «Про»). */
export const DEFAULT_MAX_VIDEO_HEIGHT = 720;

/**
 * TS-20: Перекодирует видео в H.264 MP4 не выше `maxHeight` (720 по умолчанию, 1080 на «Про», ADR-035) — заменяет оригинальный
 * файл — и делает постер. Видео меньшего размера не увеличивается.
 */
export async function processVideo(filePath: string, mediaId: string, maxHeight: number = DEFAULT_MAX_VIDEO_HEIGHT): Promise<VideoResult> {
  const cap = Math.max(2, Math.floor(maxHeight / 2) * 2);
  const dir = path.dirname(filePath);
  const tmp720p = path.join(dir, `${mediaId}_tmp_720p`);
  const posterPath = path.join(dir, `${mediaId}_poster.jpg`);

  // Транскодирование не выше cap (масштаб по высоте, без растяжения, чётные размеры)
  await exec('ffmpeg', [
    '-i', filePath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-vf', `scale=-2:min(${cap}\\,trunc(ih/2)*2)`,
    '-c:a', 'aac',
    '-movflags', 'faststart',
    '-f', 'mp4',
    '-y', tmp720p,
  ]);

  // Первый кадр как постер
  await exec('ffmpeg', [
    '-i', filePath,
    '-vframes', '1',
    '-q:v', '3',
    '-y', posterPath,
  ]);

  // Атомарно заменяем оригинал перекодированным файлом
  await rename(tmp720p, filePath);

  const info = await probeVideo(filePath);
  return { ...info, variants: { poster: posterPath } };
}

/** Длина видео в миллисекундах по данным контейнера (до перекодирования). */
export async function probeDurationMs(filePath: string): Promise<number> {
  return probeAudioMs(filePath);
}

/** Видео длиннее, чем разрешает тариф автора (TS-20, таблица тарифов «Видео — макс.»). */
export class VideoTooLongError extends Error {
  constructor(public readonly durationMs: number, public readonly maxSeconds: number) {
    super(`Видео ${Math.ceil(durationMs / 1000)} с длиннее допустимых ${maxSeconds} с`);
  }
}

/** Бросает VideoTooLongError, если видео длиннее `maxSeconds` (полсекунды запаса на округление контейнера). */
export async function assertVideoLength(filePath: string, maxSeconds: number): Promise<void> {
  const length = await probeDurationMs(filePath);
  if (length > maxSeconds * 1000 + 500) throw new VideoTooLongError(length, maxSeconds);
}

export interface AudioResult {
  durationMs: number;
  /** Пути к дополнительным вариантам (opus). */
  variants: Record<string, string>;
}

async function probeAudioMs(filePath: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath]);
  const info = JSON.parse(stdout) as { format?: { duration?: string } };
  return Math.round(parseFloat(info.format?.duration ?? '0') * 1000);
}

/**
 * TS-20 · аудио → AAC (контейнер MP4, играет везде) вместо оригинала + вариант Opus (для браузеров, где он экономнее).
 * Метаданные (теги, обложка) выбрасываются: `-vn -map_metadata -1`. Оригинал атомарно заменяется AAC-файлом.
 */
export async function processAudio(filePath: string, mediaId: string): Promise<AudioResult> {
  const dir = path.dirname(filePath);
  const tmpAac = path.join(dir, `${mediaId}_tmp_aac`);
  const opusPath = path.join(dir, `${mediaId}.opus.ogg`);

  await exec('ffmpeg', ['-i', filePath, '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '128k', '-movflags', 'faststart', '-f', 'mp4', '-y', tmpAac]);

  // Opus есть не в каждой сборке ffmpeg: без него остаётся один AAC.
  let hasOpus = false;
  try {
    await exec('ffmpeg', ['-i', filePath, '-vn', '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg', '-y', opusPath]);
    hasOpus = true;
  } catch {
    // libopus недоступен
  }

  await rename(tmpAac, filePath);
  const durationMs = await probeAudioMs(filePath);
  return { durationMs, variants: hasOpus ? { opus: opusPath } : {} };
}
