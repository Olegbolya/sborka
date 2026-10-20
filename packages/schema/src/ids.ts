import { z } from 'zod';

/** Current version of the project document format (docs/02-ARCHITECTURE.md §4). */
export const SCHEMA_VERSION = 1 as const;

/** Alphabet for generated ids and public slugs: lowercase latin and digits without look-alikes (0/o, 1/l/i). */
export const SAFE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const randomIndexes = (count: number, size: number): number[] => {
  // Rejection sampling keeps the distribution uniform for any alphabet size.
  const limit = 256 - (256 % size);
  const out: number[] = [];
  while (out.length < count) {
    const bytes = new Uint8Array(count * 2);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) out.push(b % size);
      if (out.length === count) break;
    }
  }
  return out;
};

/** Random id from {@link SAFE_ALPHABET}; 16 chars ≈ 79 bits of entropy. */
export function createId(length = 16): string {
  if (!Number.isInteger(length) || length < 6 || length > 64) throw new RangeError('Длина идентификатора — от 6 до 64 символов');
  return randomIndexes(length, SAFE_ALPHABET.length)
    .map((i) => SAFE_ALPHABET[i])
    .join('');
}

/** Default public slug of a project (PL-01): 8 characters without look-alike letters. */
export function createSlug(): string {
  return createId(8);
}

export const idSchema = z
  .string()
  .min(6)
  .max(64)
  .regex(/^[a-z0-9_-]+$/, 'Идентификатор может содержать только латинские буквы, цифры, «_» и «-»');

/** Custom slug chosen by the creator on paid plans (PL-01). */
export const customSlugSchema = z
  .string()
  .min(3, 'Адрес — не короче 3 символов')
  .max(40, 'Адрес — не длиннее 40 символов')
  .regex(/^[a-z0-9-]+$/, 'В адресе можно использовать только строчные латинские буквы, цифры и дефис')
  .refine((s) => !s.startsWith('-') && !s.endsWith('-'), 'Адрес не может начинаться или заканчиваться дефисом')
  .refine((s) => !s.includes('--'), 'В адресе не может быть двух дефисов подряд');
