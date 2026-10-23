import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'bullmq';
import type { RedisOptions } from 'bullmq';
import type { Db } from '@blokum/db';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import type { Logger } from '@blokum/observability';
import { scanFile, isClamAvailable } from './clamav.js';
import { processImage } from './images.js';
import { cleanLottie, LottieError } from './lottie.js';
import { MEDIA_QUEUE_NAME, MEDIA_PROCESS_JOB, type MediaJobData } from './jobs.js';

export interface MediaProcessorOptions {
  connection: RedisOptions;
  mediaDir: string;
  quarantineDir: string;
  db: Db;
  logger: Logger;
}

/** P4.2: Start the BullMQ worker that processes uploaded media files. */
export function startMediaProcessor(opts: MediaProcessorOptions): Worker {
  const worker = new Worker<MediaJobData>(
    MEDIA_QUEUE_NAME,
    async (job) => {
      if (job.name !== MEDIA_PROCESS_JOB) return;
      await processJob(job.data, opts);
    },
    { connection: opts.connection, prefix: 'bk', concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    opts.logger.error({ err, jobId: job?.id }, 'Задача media упала');
  });

  return worker;
}

async function processJob(data: MediaJobData, opts: MediaProcessorOptions): Promise<void> {
  const { mediaId, ownerId, filePath, kind } = data;
  const { db, logger, mediaDir, quarantineDir } = opts;

  // Mark as PROCESSING.
  await db.update(schema.media).set({ status: 'PROCESSING' }).where(eq(schema.media.id, mediaId));

  try {
    // TS-21: ClamAV scan.
    const clamReady = await isClamAvailable();
    if (clamReady) {
      const scan = await scanFile(filePath);
      if (scan.isVirus) {
        // Move to quarantine.
        const { rename, mkdir } = await import('node:fs/promises');
        await mkdir(quarantineDir, { recursive: true });
        const dest = path.join(quarantineDir, path.basename(filePath));
        await rename(filePath, dest);
        await db.update(schema.media).set({ status: 'BLOCKED' }).where(eq(schema.media.id, mediaId));
        logger.warn({ mediaId, virusName: scan.virusName }, 'TS-21 · медиафайл заблокирован (вирус)');
        return;
      }
    } else {
      logger.warn({ mediaId }, 'ClamAV недоступен — скан пропущен (TS-21)');
    }

    let variants: Record<string, unknown> = {};
    let width: number | null = null;
    let height: number | null = null;
    let mime = data.mime;

    if (kind === 'IMAGE') {
      // TS-20: re-encode (strips payload) + EXIF removal + variants.
      const destDir = path.join(mediaDir, ownerId);
      const result = await processImage(filePath, destDir, mediaId);
      width = result.meta.width;
      height = result.meta.height;
      mime = result.meta.mime;
      variants = result.variants as unknown as Record<string, unknown>;
      // Replace original with re-encoded version (HEIC→JPEG or WebP).
      if (result.variants.original !== filePath) {
        const { unlink } = await import('node:fs/promises');
        try { await unlink(filePath); } catch { /* already gone */ }
      }
    }

    if (kind === 'LOTTIE' && data.mime === 'application/json') {
      // TS-25: clean expressions + validate.
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(filePath, 'utf8');
      const cleaned = cleanLottie(JSON.parse(raw) as Record<string, unknown>);
      await writeFile(filePath, JSON.stringify(cleaned));
    }

    await db.update(schema.media).set({
      status: 'READY',
      width: width ?? undefined,
      height: height ?? undefined,
      mime,
      variants,
    }).where(eq(schema.media.id, mediaId));

    logger.info({ mediaId, kind }, 'Медиафайл обработан → READY');
  } catch (err) {
    const isLottieErr = err instanceof LottieError;
    await db.update(schema.media).set({ status: 'REJECTED' }).where(eq(schema.media.id, mediaId));
    if (isLottieErr) {
      logger.warn({ mediaId, err }, 'Lottie отклонён (TS-25)');
    } else {
      logger.error({ mediaId, err }, 'Ошибка обработки медиафайла → REJECTED');
    }
  }
}
