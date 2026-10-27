import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** PL-08 · the password of a project is kept only as a salted hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltHex, keyHex] = stored.split('$');
  if (kind !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * The proof that the password was entered: an HMAC over the project and the current hash of the password, so changing
 * the password makes every earlier proof useless. It is kept by the browser for the tab and checked by the server.
 */
export function unlockToken(secretHex: string, projectId: string, passwordHash: string): string {
  return createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`unlock:${projectId}:${passwordHash}`).digest('base64url');
}

export function checkUnlockToken(secretHex: string, projectId: string, passwordHash: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(unlockToken(secretHex, projectId, passwordHash));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** PL-10 · the device token of the browser is stored only as a hash tied to the project (no fingerprints, TS-12). */
export const deviceHash = (projectId: string, deviceToken: string): string => createHash('sha256').update(`device:${projectId}:${deviceToken}`).digest('hex');
