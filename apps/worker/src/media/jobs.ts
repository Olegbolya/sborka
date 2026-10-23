/** BullMQ job data for the `media` queue (mirrors apps/api/src/media/media-jobs.ts). */
export interface MediaJobData {
  mediaId: string;
  ownerId: string;
  filePath: string;
  mime: string;
  kind: 'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE';
}

export const MEDIA_QUEUE_NAME = 'media';
export const MEDIA_PROCESS_JOB = 'process';
