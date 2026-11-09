import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isFfmpegAvailable, processGif, processVideo } from '../src/media/video.js';

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
});
