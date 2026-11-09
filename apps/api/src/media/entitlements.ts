import type { MediaKind } from './signatures.js';
import type { PlanLimits } from '../entitlements/entitlements.service.js';

/** Предельный размер аудио и Lottie: в таблице тарифов своих полей нет (аудио — как фото, Lottie — TS-25). */
const LOTTIE_MAX_BYTES = 5 * 1024 * 1024;

type MediaLimits = Pick<PlanLimits, 'storageBytes' | 'maxImageBytes' | 'maxGifBytes' | 'maxVideoBytes'>;

export class QuotaError extends Error {
  constructor(
    public readonly code: 'FILE_TOO_LARGE' | 'QUOTA_EXCEEDED',
    message: string,
    public readonly limitBytes?: number,
    public readonly usedBytes?: number,
    public readonly totalBytes?: number,
  ) {
    super(message);
  }
}

/** Returns the per-file limit for the kind. */
export function fileLimitBytes(kind: MediaKind, limits: MediaLimits): number {
  switch (kind) {
    case 'IMAGE': return limits.maxImageBytes;
    case 'GIF': return limits.maxGifBytes;
    case 'VIDEO': return limits.maxVideoBytes;
    case 'AUDIO': return limits.maxImageBytes;
    case 'LOTTIE': return LOTTIE_MAX_BYTES;
  }
}

/** Throws QuotaError if file exceeds per-kind size limit. */
export function checkFileSize(kind: MediaKind, sizeBytes: number, limits: MediaLimits): void {
  const limit = fileLimitBytes(kind, limits);
  if (sizeBytes > limit) {
    throw new QuotaError(
      'FILE_TOO_LARGE',
      `Файл превышает лимит для типа ${kind}: ${Math.ceil(sizeBytes / 1024 / 1024)} МБ из ${limit / 1024 / 1024} МБ`,
      limit,
    );
  }
}

/** Throws QuotaError if adding fileBytes would exceed the user's storage quota. */
export function checkStorageQuota(usedBytes: number, fileBytes: number, limits: MediaLimits): void {
  if (usedBytes + fileBytes > limits.storageBytes) {
    throw new QuotaError(
      'QUOTA_EXCEEDED',
      `Превышена квота хранилища: занято ${Math.ceil(usedBytes / 1024 / 1024)} МБ из ${limits.storageBytes / 1024 / 1024} МБ`,
      limits.storageBytes,
      usedBytes,
      limits.storageBytes,
    );
  }
}
