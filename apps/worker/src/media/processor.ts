import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'bullmq';
import type { RedisOptions } from 'bullmq';
import type { Db } from '@blokum/db';
import { schema } from '@blokum/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Logger } from '@blokum/observability';
import { dominantColors, PALETTE_MAX } from '@blokum/schema';
import { scanFile, isClamAvailable } from './clamav.js';
import { processImage } from './images.js';
import { cleanLottie, LottieError } from './lottie.js';
import { MEDIA_QUEUE_NAME, MEDIA_PROCESS_JOB, type MediaJobData } from './jobs.js';
import { computePhash, phashDistance, PHASH_MAX_DISTANCE } from './phash.js';
import { classifyNsfw, isNsfwModelAvailable } from './nsfw.js';
import { DEFAULT_MAX_VIDEO_HEIGHT, isFfmpegAvailable, assertVideoLength, processAudio, processGif, processVideo, VideoTooLongError } from './video.js';

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
    let durationMs: number | null = null;
    let mime = data.mime;
    let phash: string | null = null;
    let palette: string[] | null = null;
    const moderation: Record<string, unknown> = {};

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

      const processedPath = result.variants.original;

      // TH-02: извлекаем палитру доминирующих цветов из изображения.
      try {
        const pixels = await sharp(processedPath)
          .resize(64, 64, { fit: 'inside' })
          .removeAlpha()
          .raw()
          .toBuffer();
        palette = dominantColors(pixels, PALETTE_MAX);
      } catch (e) {
        logger.warn({ mediaId, err: e }, 'TH-02 · палитра не извлечена');
      }

      // TS-23: compute pHash of the re-encoded image.
      try {
        phash = await computePhash(processedPath);
      } catch (e) {
        logger.warn({ mediaId, err: e }, 'TS-23 · pHash вычислить не удалось');
      }

      // TS-23: check against stop-list of blocked hashes.
      if (phash) {
        const stopList = await db.select({ phash: schema.mediaBlockedHashes.phash }).from(schema.mediaBlockedHashes);
        const hit = stopList.find((row) => phashDistance(phash!, row.phash) <= PHASH_MAX_DISTANCE);
        if (hit) {
          await db.update(schema.media)
            .set({ status: 'BLOCKED', phash, moderation: { blockedByStopList: true, matchedHash: hit.phash } })
            .where(eq(schema.media.id, mediaId));
          logger.warn({ mediaId, matchedHash: hit.phash }, 'TS-23 · медиафайл заблокирован (стоп-лист pHash)');
          return;
        }
      }

      // TS-22: NSFW classification.
      if (isNsfwModelAvailable()) {
        const nsfw = await classifyNsfw(processedPath);
        if (nsfw) {
          moderation.nsfw = { score: nsfw.score, topClass: nsfw.topClass, verdict: nsfw.verdict, scores: nsfw.scores };
          if (nsfw.verdict === 'block') {
            await db.update(schema.media)
              .set({ status: 'BLOCKED', phash: phash ?? undefined, moderation })
              .where(eq(schema.media.id, mediaId));
            logger.warn({ mediaId, nsfwScore: nsfw.score, topClass: nsfw.topClass }, 'TS-22 · медиафайл заблокирован (NSFW выше порога)');
            return;
          }
          if (nsfw.verdict === 'flag') {
            moderation.flaggedForReview = true;
            logger.info({ mediaId, nsfwScore: nsfw.score }, 'TS-22 · медиафайл помечен для проверки (NSFW средний порог)');
          }
        }
      } else {
        logger.warn({ mediaId }, `NSFW-модель недоступна — классификация пропущена (TS-22); путь: ${process.env.NSFW_MODEL_PATH ?? '~/blokum/models/nsfw.onnx'}`);
      }
    }

    if (kind === 'GIF') {
      // TS-20 · B-03: GIF → MP4 (faststart, yuv420p) + WebM + постер.
      if (await isFfmpegAvailable()) {
        const result = await processGif(filePath, mediaId);
        width = result.width;
        height = result.height;
        durationMs = result.durationMs;
        mime = 'video/mp4';
        variants = result.variants;
        logger.info({ mediaId }, 'TS-20 · GIF → MP4/WebM конвертирован');
      } else {
        logger.warn({ mediaId }, 'ffmpeg недоступен — GIF-конвертация пропущена (TS-20)');
      }
    }

    if (kind === 'VIDEO') {
      // TS-20: перекодирование видео в H.264 MP4 (720p; 1080p на «Про», ADR-035).
      if (await isFfmpegAvailable()) {
        // Длину проверяем до перекодирования: слишком длинное видео не тратит время процессора.
        if (data.maxVideoSeconds !== undefined) {
          await assertVideoLength(filePath, data.maxVideoSeconds);
        }
        const result = await processVideo(filePath, mediaId, data.maxVideoHeight ?? DEFAULT_MAX_VIDEO_HEIGHT);
        width = result.width;
        height = result.height;
        durationMs = result.durationMs;
        mime = 'video/mp4';
        variants = result.variants;
        logger.info({ mediaId, maxHeight: data.maxVideoHeight ?? DEFAULT_MAX_VIDEO_HEIGHT }, 'TS-20 · VIDEO → H.264 MP4 перекодирован');
      } else {
        logger.warn({ mediaId }, 'ffmpeg недоступен — VIDEO-перекодирование пропущено (TS-20)');
      }
    }

    if (kind === 'AUDIO') {
      // TS-20: аудио → AAC (оригинал заменяется) + Opus; теги и обложка выброшены.
      if (await isFfmpegAvailable()) {
        const result = await processAudio(filePath, mediaId);
        durationMs = result.durationMs;
        mime = 'audio/mp4';
        variants = result.variants;
        logger.info({ mediaId }, 'TS-20 · AUDIO → AAC/Opus перекодирован');
      } else {
        logger.warn({ mediaId }, 'ffmpeg недоступен — AUDIO-перекодирование пропущено (TS-20)');
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
      durationMs: durationMs ?? undefined,
      mime,
      phash: phash ?? undefined,
      palette: palette ?? undefined,
      moderation,
      variants,
    }).where(eq(schema.media.id, mediaId));

    logger.info({ mediaId, kind }, 'Медиафайл обработан → READY');
  } catch (err) {
    const isLottieErr = err instanceof LottieError;
    const tooLong = err instanceof VideoTooLongError;
    await db.update(schema.media).set({ status: 'REJECTED', ...(tooLong ? { moderation: { rejected: 'VIDEO_TOO_LONG', maxSeconds: err.maxSeconds } } : {}) }).where(eq(schema.media.id, mediaId));
    if (tooLong) {
      logger.warn({ mediaId, maxSeconds: err.maxSeconds, durationMs: err.durationMs }, 'TS-20 · видео длиннее лимита тарифа → REJECTED');
    } else if (isLottieErr) {
      logger.warn({ mediaId, err }, 'Lottie отклонён (TS-25)');
    } else {
      logger.error({ mediaId, err }, 'Ошибка обработки медиафайла → REJECTED');
    }
  }
}
