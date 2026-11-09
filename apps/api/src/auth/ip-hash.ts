import { createHmac, randomBytes } from 'node:crypto';

/**
 * ADR-048 · IP-адрес, даже хэшированный, — персональные данные. Поэтому хэш считается с секретной солью, которая
 * живёт только в памяти процесса и только в рамках одних суток (UTC): на следующие сутки соль заменяется новой,
 * а старая уничтожается. Восстановить адрес по хэшу или сопоставить посещения разных суток нельзя.
 */
let day = '';
let salt: Buffer | null = null;

function saltFor(now: Date): Buffer {
  const today = now.toISOString().slice(0, 10);
  if (salt === null || today !== day) {
    salt?.fill(0);
    salt = randomBytes(32);
    day = today;
  }
  return salt;
}

/** HMAC-SHA256(ip) с ежесуточно уничтожаемой солью; `length` — сколько знаков hex оставить. */
export function hashIp(ip: string, now: Date = new Date(), length = 16): string {
  return createHmac('sha256', saltFor(now)).update(ip).digest('hex').slice(0, length);
}

/** Для тестов: забыть соль (как при смене суток). */
export function forgetIpSalt(): void {
  salt?.fill(0);
  salt = null;
  day = '';
}
