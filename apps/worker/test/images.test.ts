import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { processImage } from '../src/media/images.js';

let tmpDir = '';

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'imgtest-'));
});

afterAll(() => {
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function makeJpeg(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 100, b: 50 } } })
    .jpeg({ quality: 80 })
    .toBuffer();
}

describe('TS-20 · image processing', () => {
  it('TS-20 · конвертирует JPEG в WebP и удаляет EXIF', async () => {
    const src = path.join(tmpDir, 'test.jpg');
    writeFileSync(src, await makeJpeg(200, 150));
    const destDir = path.join(tmpDir, 'out1');
    const result = await processImage(src, destDir, 'mediatest1');
    expect(result.meta.mime).toBe('image/webp');
    expect(result.meta.width).toBe(200);
    expect(result.meta.height).toBe(150);
    // Verify no EXIF in output.
    const outMeta = await sharp(result.variants.original).metadata();
    expect(outMeta.exif).toBeUndefined();
  });

  it('TS-20 · создаёт варианты 480w, 960w, 1920w для большого изображения', async () => {
    const src = path.join(tmpDir, 'large.jpg');
    writeFileSync(src, await makeJpeg(2000, 1000));
    const destDir = path.join(tmpDir, 'out2');
    const result = await processImage(src, destDir, 'mediatest2');
    expect(result.variants['480w']).toBeDefined();
    expect(result.variants['960w']).toBeDefined();
    expect(result.variants['1920w']).toBeDefined();
    // Verify 480w variant is actually 480px wide.
    const v480meta = await sharp(result.variants['480w']).metadata();
    expect(v480meta.width).toBe(480);
  });

  it('TS-20 · не создаёт вариант 960w для изображения шире 500px', async () => {
    const src = path.join(tmpDir, 'small.jpg');
    writeFileSync(src, await makeJpeg(500, 300));
    const destDir = path.join(tmpDir, 'out3');
    const result = await processImage(src, destDir, 'mediatest3');
    expect(result.variants['480w']).toBeDefined();
    expect(result.variants['960w']).toBeUndefined();
  });
});
