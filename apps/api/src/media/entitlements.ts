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

/** N-05 · the kind of a file as a person calls it (the message is shown in the interface). */
const KIND_NAME: Record<MediaKind, string> = { IMAGE: 'Картинка', GIF: 'GIF-анимация', VIDEO: 'Видео', AUDIO: 'Звук', LOTTIE: 'Анимация Lottie' };

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
      `${KIND_NAME[kind]} больше допустимого на вашем тарифе: ${Math.ceil(sizeBytes / 1024 / 1024)} МБ, можно до ${limit / 1024 / 1024} МБ`,
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

export interface StorageNotice {
  kind: 'storage-80' | 'storage-95';
  title: string;
  body: string;
}

const mb = (bytes: number): string => `${Math.ceil(bytes / 1024 / 1024)} МБ`;

/**
 * D-07 · «о лимитах» (place for files): the message when an upload crosses 80 % or 95 % of the plan's storage; null when it
 * crosses nothing. A file that does not fit is refused at upload and the creator sees why at once, so there is no message for it.
 */
export function storageNotice(before: number, after: number, limit: number): StorageNotice | null {
  if (limit <= 0) return null;
  const crossed = (pct: number): boolean => before < limit * pct && after >= limit * pct;
  const where = `Занято ${mb(after)} из ${mb(limit)}.`;
  if (crossed(0.95)) {
    return {
      kind: 'storage-95',
      title: 'Место под файлы почти закончилось',
      body: `${where} Новые файлы скоро перестанут загружаться. Докупить место или перейти на тариф с большим хранилищем можно в разделе «Тариф и оплата».`,
    };
  }
  if (crossed(0.8)) {
    return {
      kind: 'storage-80',
      title: 'Занято 80 % места под файлы',
      body: `${where} Когда место закончится, новые файлы не загрузятся. Увеличить место можно в разделе «Тариф и оплата».`,
    };
  }
  return null;
}
