import type { MediaKind } from './signatures.js';

/** FREE-tier limits from docs/04-TARIFFS.md. Until P7, every user is FREE. */
export const FREE_LIMITS = {
  storageBytes: 200 * 1024 * 1024,       // 200 МБ total
  imageMaxBytes: 5 * 1024 * 1024,        // 5 МБ / фото
  gifMaxBytes: 10 * 1024 * 1024,         // 10 МБ / GIF
  videoMaxBytes: 30 * 1024 * 1024,       // 30 МБ / видео
  videoDurationMs: 60_000,               // 60 с
  audioMaxBytes: 5 * 1024 * 1024,        // 5 МБ / аудио (не указано → берём фото-лимит)
  lottieMaxBytes: 5 * 1024 * 1024,       // 5 МБ (TS-25)
  themes: 2,
  passesPerMonth: 100,                   // прохождений в месяц на аккаунт (PL-07)                             // свои темы (TH-02, TH-03)
} as const;

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
export function fileLimitBytes(kind: MediaKind): number {
  switch (kind) {
    case 'IMAGE': return FREE_LIMITS.imageMaxBytes;
    case 'GIF': return FREE_LIMITS.gifMaxBytes;
    case 'VIDEO': return FREE_LIMITS.videoMaxBytes;
    case 'AUDIO': return FREE_LIMITS.audioMaxBytes;
    case 'LOTTIE': return FREE_LIMITS.lottieMaxBytes;
  }
}

/** Throws QuotaError if file exceeds per-kind size limit. */
export function checkFileSize(kind: MediaKind, sizeBytes: number): void {
  const limit = fileLimitBytes(kind);
  if (sizeBytes > limit) {
    throw new QuotaError(
      'FILE_TOO_LARGE',
      `Файл превышает лимит для типа ${kind}: ${Math.ceil(sizeBytes / 1024 / 1024)} МБ из ${limit / 1024 / 1024} МБ`,
      limit,
    );
  }
}

/** Throws QuotaError if adding fileBytes would exceed the user's storage quota. */
export function checkStorageQuota(usedBytes: number, fileBytes: number): void {
  if (usedBytes + fileBytes > FREE_LIMITS.storageBytes) {
    throw new QuotaError(
      'QUOTA_EXCEEDED',
      `Превышена квота хранилища: занято ${Math.ceil(usedBytes / 1024 / 1024)} МБ из ${FREE_LIMITS.storageBytes / 1024 / 1024} МБ`,
      FREE_LIMITS.storageBytes,
      usedBytes,
      FREE_LIMITS.storageBytes,
    );
  }
}
