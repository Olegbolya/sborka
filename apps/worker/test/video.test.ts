import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertVideoLength, isFfmpegAvailable, processAudio, processGif, processVideo, VideoTooLongError } from '../src/media/video.js';

const exec = promisify(execFile);

let tmpDir = '';
// Проверка до сбора тестов: `skipIf` читает значение сразу, поэтому присваивание в beforeAll приводило к тому, что тесты видео пропускались всегда.
const ffmpegReady = await isFfmpegAvailable();

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'videotest-'));
});

afterAll(() => {
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function makeTestGif(): Promise<string> {
  const outPath = path.join(tmpDir, 'test.gif');
  await exec('ffmpeg', [
    '-f', 'lavfi',
    '-i', 'color=c=blue:size=16x16:duration=0.5:rate=5',
    '-y', outPath,
  ]);
  return outPath;
}

async function makeTestMp4(): Promise<string> {
  const outPath = path.join(tmpDir, 'test.mp4');
  await exec('ffmpeg', [
    '-f', 'lavfi',
    '-i', 'color=c=red:size=320x180:duration=0.5:rate=5',
    '-c:v', 'libx264',
    '-y', outPath,
  ]);
  return outPath;
}

describe('TS-20 · GIF и VIDEO перекодирование', () => {
  it('isFfmpegAvailable возвращает boolean', () => {
    expect(typeof ffmpegReady).toBe('boolean');
  });

  it.skipIf(!ffmpegReady)('TS-20 · B-03 · processGif конвертирует GIF → MP4 и постер', async () => {
    const gifPath = await makeTestGif();
    const mediaId = 'test-gif-id';
    // Копируем gif в filePath без расширения (как хранит медиасервис)
    const filePath = path.join(tmpDir, mediaId);
    await rename(gifPath, filePath);

    const result = await processGif(filePath, mediaId);

    // После конвертации filePath теперь содержит MP4-данные
    expect(existsSync(filePath)).toBe(true);
    // Постер должен существовать
    expect(existsSync(result.variants['poster'] as string)).toBe(true);
    // Метаданные
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it.skipIf(!ffmpegReady)('TS-20 · processVideo перекодирует видео в 720p и создаёт постер', async () => {
    const mp4Path = await makeTestMp4();
    const mediaId = 'test-video-id';
    const filePath = path.join(tmpDir, mediaId);
    await rename(mp4Path, filePath);

    const result = await processVideo(filePath, mediaId);

    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(result.variants['poster'] as string)).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    // Высота после 720p-масштаба: не более 720
    expect(result.height).toBeLessThanOrEqual(720);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  async function makeFullHd(name: string): Promise<string> {
    const out = path.join(tmpDir, `${name}.mp4`);
    await exec('ffmpeg', ['-f', 'lavfi', '-i', 'color=c=green:size=1920x1080:duration=0.4:rate=5', '-c:v', 'libx264', '-y', out]);
    return out;
  }

  it.skipIf(!ffmpegReady)('TS-20 · ADR-035 · «Про»: видео 1080p остаётся 1080p, на остальных тарифах сжимается до 720p', async () => {
    const pro = path.join(tmpDir, 'hd-pro');
    await rename(await makeFullHd('hd-a'), pro);
    const proResult = await processVideo(pro, 'hd-pro', 1080);
    expect(proResult.height).toBe(1080);

    const base = path.join(tmpDir, 'hd-base');
    await rename(await makeFullHd('hd-b'), base);
    const baseResult = await processVideo(base, 'hd-base');
    expect(baseResult.height).toBe(720);
    expect(baseResult.width).toBe(1280);
  });

  it.skipIf(!ffmpegReady)('TS-20 · ADR-035 · маленькое видео не увеличивается даже на «Про»', async () => {
    const small = path.join(tmpDir, 'small-pro');
    await rename(await makeTestMp4(), small);
    const result = await processVideo(small, 'small-pro', 1080);
    expect(result.height).toBe(180);
    expect(result.width).toBe(320);
  });

  it.skipIf(!ffmpegReady)('TS-20 · аудио → AAC вместо оригинала, вариант Opus, теги выброшены', async () => {
    const src = path.join(tmpDir, 'tone.mp3');
    await exec('ffmpeg', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-metadata', 'title=СекретныйТег', '-metadata', 'artist=Автор', '-y', src]);
    const filePath = path.join(tmpDir, 'test-audio-id');
    await rename(src, filePath);

    const result = await processAudio(filePath, 'test-audio-id');

    const { stdout } = await exec('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', filePath]);
    const info = JSON.parse(stdout) as { streams: Array<{ codec_type: string; codec_name: string }>; format: { format_name: string; tags?: Record<string, string> } };
    expect(info.streams.map((s) => s.codec_type)).toEqual(['audio']);
    expect(info.streams[0]!.codec_name).toBe('aac');
    expect(info.format.format_name).toContain('mp4');
    expect(JSON.stringify(info.format.tags ?? {})).not.toContain('СекретныйТег');
    expect(result.durationMs).toBeGreaterThan(800);
    expect(result.durationMs).toBeLessThan(1300);
    const opus = result.variants['opus'];
    if (opus) {
      expect(existsSync(opus)).toBe(true);
      const o = await exec('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', opus]);
      expect((JSON.parse(o.stdout) as { streams: Array<{ codec_name: string }> }).streams[0]!.codec_name).toBe('opus');
    }
  });

  it.skipIf(!ffmpegReady)('TS-20 · видео длиннее лимита тарифа отклоняется до перекодирования, в пределах лимита — проходит', async () => {
    const clip = path.join(tmpDir, 'long.mp4');
    await exec('ffmpeg', ['-f', 'lavfi', '-i', 'color=c=red:size=64x64:duration=3:rate=5', '-c:v', 'libx264', '-y', clip]);
    await expect(assertVideoLength(clip, 2)).rejects.toBeInstanceOf(VideoTooLongError);
    await expect(assertVideoLength(clip, 2)).rejects.toMatchObject({ maxSeconds: 2 });
    await expect(assertVideoLength(clip, 3)).resolves.toBeUndefined();
    await expect(assertVideoLength(clip, 60)).resolves.toBeUndefined();
  });
});
