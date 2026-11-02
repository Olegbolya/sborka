import sharp from 'sharp';

/**
 * TS-23 · difference hash (dHash) of an image — 64-bit fingerprint for perceptual similarity.
 *
 * Algorithm:
 * 1. Resize to 9×8 in grayscale (bicubic to preserve edges).
 * 2. For each row, compare adjacent pixels: left > right → bit 1, else → bit 0.
 * 3. 8 rows × 8 comparisons = 64 bits → 16-char lowercase hex string.
 *
 * Two images are considered perceptually identical when their Hamming distance is ≤ PHASH_MAX_DISTANCE.
 */
export const PHASH_MAX_DISTANCE = 6;

export async function computePhash(inputPath: string): Promise<string> {
  const { data } = await sharp(inputPath, { failOn: 'none' })
    .resize(9, 8, { fit: 'fill', kernel: 'cubic' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // data is a Buffer of 9×8 = 72 bytes (one byte per pixel, row-major)
  let bits = BigInt(0);
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col] ?? 0;
      const right = data[row * 9 + col + 1] ?? 0;
      bits = (bits << BigInt(1)) | BigInt(left > right ? 1 : 0);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/** Hamming distance between two hex pHash strings (number of differing bits). */
export function phashDistance(a: string, b: string): number {
  const diff = BigInt('0x' + a) ^ BigInt('0x' + b);
  let d = diff;
  let n = 0;
  while (d > 0n) {
    n += Number(d & 1n);
    d >>= 1n;
  }
  return n;
}
