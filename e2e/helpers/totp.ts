import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The six digits an authenticator app shows for a secret in base32 (RFC 6238: SHA-1, 30 s, 6 digits). */
export function totpCode(secret: string, now = Date.now()): string {
  let bits = '';
  for (const ch of secret.replace(/=+$/, '')) bits += ALPHABET.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
