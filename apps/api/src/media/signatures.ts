import { fileTypeFromBuffer } from 'file-type';

export type MediaKind = 'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE';

/** TS-01: file types that must never be stored or served. */
const FORBIDDEN_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'application/pdf',
  'application/x-executable',
  'application/x-msdownload',
  'application/x-dosexec',
  'application/x-msdos-program',
  'image/svg+xml',
]);

/** Maps detected MIME type to MediaKind. */
const MIME_TO_KIND: Record<string, MediaKind> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/webp': 'IMAGE',
  'image/avif': 'IMAGE',
  'image/heic': 'IMAGE',
  'image/heif': 'IMAGE',
  'image/gif': 'GIF',
  'video/mp4': 'VIDEO',
  'video/quicktime': 'VIDEO',
  'video/webm': 'VIDEO',
  'audio/mpeg': 'AUDIO',
  'audio/wav': 'AUDIO',
  'audio/x-wav': 'AUDIO',
  'audio/ogg': 'AUDIO',
  'audio/aac': 'AUDIO',
  'audio/mp4': 'AUDIO',
  'audio/x-m4a': 'AUDIO',
  'audio/flac': 'AUDIO',
};

export class SignatureError extends Error {
  constructor(
    public readonly code: 'FORBIDDEN_TYPE' | 'UNKNOWN_TYPE' | 'LOTTIE_TOO_LARGE' | 'LOTTIE_INVALID',
    message: string,
  ) {
    super(message);
  }
}

/**
 * TS-01/TS-20: validate file by magic bytes, not extension.
 * Returns detected kind and canonical MIME.
 */
export async function checkSignature(buffer: Buffer): Promise<{ kind: MediaKind; mime: string }> {
  // Lottie JSON: no magic bytes, identified by content structure.
  const prefix = buffer.subarray(0, 512).toString('utf8');
  if (prefix.trimStart().startsWith('{')) {
    try {
      const obj = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
      if (typeof obj['v'] === 'string' && Array.isArray(obj['layers'])) {
        if (buffer.length > 5 * 1024 * 1024) {
          throw new SignatureError('LOTTIE_TOO_LARGE', 'Lottie-файл превышает 5 МБ (TS-25)');
        }
        return { kind: 'LOTTIE', mime: 'application/json' };
      }
    } catch (e) {
      if (e instanceof SignatureError) throw e;
      // Not valid JSON — fall through to magic byte detection.
    }
  }

  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    const lower = prefix.trimStart().toLowerCase();
    if (lower.startsWith('<!doctype') || lower.startsWith('<html')) {
      throw new SignatureError('FORBIDDEN_TYPE', 'HTML-файлы запрещены (TS-01)');
    }
    throw new SignatureError('UNKNOWN_TYPE', 'Не удалось определить тип файла по сигнатуре');
  }

  if (FORBIDDEN_MIMES.has(detected.mime)) {
    throw new SignatureError('FORBIDDEN_TYPE', `Тип «${detected.mime}» запрещён к загрузке (TS-01)`);
  }

  // .lottie is a ZIP file (PK header) containing a Lottie animation.
  if (detected.mime === 'application/zip') {
    return { kind: 'LOTTIE', mime: 'application/zip' };
  }

  const kind = MIME_TO_KIND[detected.mime];
  if (!kind) {
    throw new SignatureError('FORBIDDEN_TYPE', `Тип «${detected.mime}» не разрешён`);
  }

  return { kind, mime: detected.mime };
}
