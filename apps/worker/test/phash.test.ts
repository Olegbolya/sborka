import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { computePhash, phashDistance, PHASH_MAX_DISTANCE } from '../src/media/phash.js';
import { isNsfwModelAvailable, classifyNsfw, NSFW_HIGH_THRESHOLD, NSFW_MID_THRESHOLD } from '../src/media/nsfw.js';

let tmpDir = '';

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'phashtest-'));
});

afterAll(() => {
  try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function makeImage(w: number, h: number, r: number, g: number, b: number): Promise<string> {
  const p = path.join(tmpDir, `img_${r}_${g}_${b}_${w}x${h}.webp`);
  await sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
    .webp()
    .toFile(p);
  return p;
}

describe('TS-23 · pHash', () => {
  it('TS-23 · computePhash возвращает 16-символьную hex-строку', async () => {
    const img = await makeImage(200, 200, 100, 150, 200);
    const hash = await computePhash(img);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('TS-23 · одинаковые изображения имеют нулевое расстояние', async () => {
    const img = await makeImage(100, 100, 80, 80, 80);
    const h1 = await computePhash(img);
    const h2 = await computePhash(img);
    expect(phashDistance(h1, h2)).toBe(0);
  });

  it('TS-23 · изображения с разными горизонтальными градиентами имеют большое расстояние', async () => {
    // Left-to-right gradient: bright left, dark right.
    const bright = path.join(tmpDir, 'grad_bright.webp');
    const dark = path.join(tmpDir, 'grad_dark.webp');
    // 64×64 with strong left-bright gradient
    const brightBuf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 200, b: 200 } },
    }).composite([{ input: Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => {
      const x = Math.floor(i / 3) % 64;
      return i % 3 === 0 ? Math.round(255 * x / 63) : i % 3 === 1 ? Math.round(255 * x / 63) : Math.round(255 * x / 63);
    })), raw: { width: 64, height: 64, channels: 3 } }]).webp().toBuffer();
    // Right-to-left gradient: dark left, bright right (opposite direction).
    const darkBuf = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 200, b: 200 } },
    }).composite([{ input: Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => {
      const x = Math.floor(i / 3) % 64;
      return Math.round(255 * (1 - x / 63));
    })), raw: { width: 64, height: 64, channels: 3 } }]).webp().toBuffer();
    await sharp(brightBuf).toFile(bright);
    await sharp(darkBuf).toFile(dark);
    const hb = await computePhash(bright);
    const hd = await computePhash(dark);
    // Opposite gradients should differ by many bits (close to 64).
    expect(phashDistance(hb, hd)).toBeGreaterThan(PHASH_MAX_DISTANCE);
  });

  it('TS-23 · небольшое изменение яркости — расстояние в пределах допуска', async () => {
    const a = await makeImage(100, 100, 120, 120, 120);
    const b = await makeImage(100, 100, 125, 125, 125);
    const ha = await computePhash(a);
    const hb = await computePhash(b);
    expect(phashDistance(ha, hb)).toBeLessThanOrEqual(PHASH_MAX_DISTANCE);
  });

  it('TS-23 · phashDistance работает на граничных значениях (0 и 0xffffffffffffffff)', () => {
    expect(phashDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(phashDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(phashDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
  });
});

describe('TS-22 · NSFW classifier', () => {
  it('TS-22 · isNsfwModelAvailable возвращает boolean', () => {
    expect(typeof isNsfwModelAvailable()).toBe('boolean');
  });

  it.skipIf(!isNsfwModelAvailable())('TS-22 · нейтральное изображение — вердикт pass или flag', async () => {
    const img = await makeImage(224, 224, 180, 180, 200);
    const result = await classifyNsfw(img);
    expect(result).not.toBeNull();
    expect(result!.verdict).not.toBe('block');
    expect(result!.score).toBeGreaterThanOrEqual(0);
    expect(result!.score).toBeLessThanOrEqual(1);
  });

  it('TS-22 · classifyNsfw возвращает null если модель недоступна', async () => {
    if (isNsfwModelAvailable()) return;
    const img = await makeImage(224, 224, 100, 100, 100);
    const result = await classifyNsfw(img);
    expect(result).toBeNull();
  });

  it('TS-22 · NSFW_HIGH_THRESHOLD > NSFW_MID_THRESHOLD > 0', () => {
    expect(NSFW_HIGH_THRESHOLD).toBeGreaterThan(NSFW_MID_THRESHOLD);
    expect(NSFW_MID_THRESHOLD).toBeGreaterThan(0);
    expect(NSFW_HIGH_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
