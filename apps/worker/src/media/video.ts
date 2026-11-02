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

/**
 * TS-20: Перекодирует видео в 720p H.264 MP4 (заменяет оригинальный файл) + постер.
 */
export async function processVideo(filePath: string, mediaId: string): Promise<VideoResult> {
  const dir = path.dirname(filePath);
  const tmp720p = path.join(dir, `${mediaId}_tmp_720p`);
  const posterPath = path.join(dir, `${mediaId}_poster.jpg`);

  // Транскодирование в 720p (масштаб по высоте, без растяжения, чётные размеры)
  await exec('ffmpeg', [
    '-i', filePath,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-vf', 'scale=-2:min(720\\,trunc(ih/2)*2)',
    '-c:a', 'aac',
    '-movflags', 'faststart',
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
