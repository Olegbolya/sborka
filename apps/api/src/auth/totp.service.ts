import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type Db, schema } from '@blokum/db';
import type { ApiConfig } from '../config.js';
import { API_CONFIG, DB } from '../tokens.js';

const TOTP_STEP_SEC = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const BACKUP_CODE_COUNT = 8;

/** AD-01: RFC 6238 TOTP + AES-256-GCM secret storage + backup codes. */
@Injectable()
export class TotpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  generateSecret(): string {
    return randomBytes(20).toString('base64url');
  }

  /** Encrypts a TOTP secret with AES-256-GCM; stored value format: iv.ciphertext.tag (all hex). */
  encryptSecret(secret: string): string {
    const key = Buffer.from(this.config.totpSecretKey, 'hex');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}.${ct.toString('hex')}.${tag.toString('hex')}`;
  }

  decryptSecret(encrypted: string): string {
    const [ivHex, ctHex, tagHex] = encrypted.split('.');
    if (!ivHex || !ctHex || !tagHex) throw new Error('Неверный формат зашифрованного секрета TOTP');
    const key = Buffer.from(this.config.totpSecretKey, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(ctHex, 'hex')).toString('utf8') + decipher.final('utf8');
  }

  /** Verifies a 6-digit TOTP code (allows ±TOTP_WINDOW time steps). */
  verifyTotpCode(encryptedSecret: string, code: string): boolean {
    let secret: string;
    try {
      secret = this.decryptSecret(encryptedSecret);
    } catch {
      return false;
    }
    const key = Buffer.from(secret, 'base64url');
    const now = Math.floor(Date.now() / 1000 / TOTP_STEP_SEC);
    for (let w = -TOTP_WINDOW; w <= TOTP_WINDOW; w++) {
      if (hotp(key, now + w, TOTP_DIGITS) === code) return true;
    }
    return false;
  }

  /** Generates a TOTP URI for QR code rendering. */
  totpUri(encryptedSecret: string, phone: string): string {
    const secret = this.decryptSecret(encryptedSecret);
    const encoded = encodeURIComponent(`Блокум (${phone})`);
    return `otpauth://totp/${encoded}?secret=${toBase32(Buffer.from(secret, 'base64url'))}&issuer=Блокум&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SEC}`;
  }

  generateBackupCodes(): Array<{ code: string; hash: string }> {
    return Array.from({ length: BACKUP_CODE_COUNT }, () => {
      const code = randomBytes(5).toString('hex').toUpperCase();
      const hash = sha256(code);
      return { code, hash };
    });
  }

  async storeBackupCodes(userId: string, hashes: string[]): Promise<void> {
    if (typeof (this.db as unknown as Record<string, unknown>)['insert'] !== 'function') return;
    await this.db.delete(schema.totpBackupCodes).where(eq(schema.totpBackupCodes.userId, userId));
    if (hashes.length === 0) return;
    await this.db.insert(schema.totpBackupCodes).values(
      hashes.map((codeHash) => ({ id: generateId(), userId, codeHash })),
    );
  }

  /** Verifies and consumes a backup code; returns true if valid and unused. */
  async verifyAndConsumeBackupCode(userId: string, code: string): Promise<boolean> {
    if (typeof (this.db as unknown as Record<string, unknown>)['select'] !== 'function') return false;
    const hash = sha256(code.toUpperCase());
    const rows = await this.db
      .select()
      .from(schema.totpBackupCodes)
      .where(and(eq(schema.totpBackupCodes.userId, userId), eq(schema.totpBackupCodes.codeHash, hash), isNull(schema.totpBackupCodes.usedAt)))
      .limit(1);
    if (!rows[0]) return false;
    await this.db
      .update(schema.totpBackupCodes)
      .set({ usedAt: new Date() })
      .where(eq(schema.totpBackupCodes.id, rows[0].id));
    return true;
  }

  /** Clears all stored backup codes and TOTP secret for the user. */
  async revokeTotp(userId: string): Promise<void> {
    if (typeof (this.db as unknown as Record<string, unknown>)['update'] !== 'function') return;
    await Promise.all([
      this.db.update(schema.users).set({ totpSecretEnc: null }).where(eq(schema.users.id, userId)),
      this.db.delete(schema.totpBackupCodes).where(eq(schema.totpBackupCodes.userId, userId)),
    ]);
  }

  validateCodeFormat(code: string): void {
    if (!/^\d{6}$/.test(code) && !/^[0-9A-F]{10}$/.test(code)) {
      throw new BadRequestException({ error: { code: 'INVALID_TOTP_FORMAT', message: 'Неверный формат кода TOTP' } });
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateId(): string {
  return randomBytes(12).toString('hex');
}

function hotp(key: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    10 ** digits;
  return code.toString().padStart(digits, '0');
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}
