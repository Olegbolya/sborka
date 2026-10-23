import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export interface ImageVariants {
  '480w': string;
  '960w'?: string;
  '1920w'?: string;
  original: string;
}

export interface ImageMeta {
  width: number;
  height: number;
  mime: string;
}

const VARIANT_WIDTHS = [480, 960, 1920] as const;

/**
 * TS-20: Process an image file:
 * 1. Re-encode to remove any embedded payload (malicious data doesn't survive re-encoding).
 * 2. Strip all EXIF metadata (incl. GPS).
 * 3. Convert HEIC/HEIF to JPEG.
 * Returns metadata and paths to variants.
 */
export async function processImage(
  srcPath: string,
  destDir: string,
  mediaId: string,
): Promise<{ meta: ImageMeta; variants: ImageVariants }> {
  await mkdir(destDir, { recursive: true });

  const input = sharp(srcPath, { failOn: 'none' });
  const meta = await input.metadata();

  const isHeic = meta.format === 'heif';
  // Re-encode: re-encode to WebP (lossy) to strip any embedded payload + EXIF.
  // HEIC → JPEG for broader compatibility.
  // Do NOT call withMetadata() — sharp strips all EXIF by default (TS-20).
  const pipeline = isHeic
    ? input.rotate().jpeg({ quality: 85 })
    : input.rotate().webp({ quality: 82 });

  // Original re-encoded.
  const ext = isHeic ? 'jpg' : 'webp';
  const origPath = path.join(destDir, `${mediaId}.${ext}`);
  const origMime = isHeic ? 'image/jpeg' : 'image/webp';
  await pipeline.clone().toFile(origPath);

  // Variants: WebP at each breakpoint width (skip if source is smaller).
  const srcWidth = meta.width ?? 0;
  const variantPaths: Partial<ImageVariants> = { original: origPath };
  for (const w of VARIANT_WIDTHS) {
    if (srcWidth > 0 && srcWidth < w) continue;
    const varPath = path.join(destDir, `${mediaId}_${w}w.webp`);
    await sharp(srcPath, { failOn: 'none' })
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(varPath);
    (variantPaths as Record<string, string>)[`${w}w`] = varPath;
  }

  return {
    meta: {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      mime: origMime,
    },
    variants: variantPaths as ImageVariants,
  };
}
