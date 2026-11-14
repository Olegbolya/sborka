/** BullMQ job data for the `media` queue (docs/02-ARCHITECTURE.md §7). */
export interface MediaJobData {
  mediaId: string;
  ownerId: string;
  filePath: string;
  mime: string;
  kind: 'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE';
  /** Потолок высоты видео по тарифу автора (720; 1080 на «Про»). Нет — 720. */
  maxVideoHeight?: number;
  /** Предельная длина видео по тарифу автора, секунды. Нет — без проверки. */
  maxVideoSeconds?: number;
}

export const MEDIA_QUEUE_NAME = 'media';
export const MEDIA_PROCESS_JOB = 'process';

/** Minimal queue interface — lets tests inject a no-op stub without BullMQ. */
export interface IMediaQueue {
  add(name: string, data: MediaJobData): Promise<void>;
}
