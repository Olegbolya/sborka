import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetIpSalt, hashIp } from '../src/auth/ip-hash.js';

describe('ADR-048 · хэш IP-адреса с ежесуточно уничтожаемой солью', () => {
  beforeEach(() => forgetIpSalt());

  it('внутри суток хэш одного адреса стабилен, у разных адресов — разный', () => {
    const t = new Date('2026-11-09T08:00:00Z');
    expect(hashIp('203.0.113.7', t)).toBe(hashIp('203.0.113.7', new Date('2026-11-09T23:59:00Z')));
    expect(hashIp('203.0.113.7', t)).not.toBe(hashIp('203.0.113.8', t));
  });

  it('на следующие сутки соль меняется: посещения разных суток не сопоставить', () => {
    const a = hashIp('203.0.113.7', new Date('2026-11-09T12:00:00Z'));
    const b = hashIp('203.0.113.7', new Date('2026-11-10T12:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('хэш нельзя подобрать по открытым данным: дата в качестве ключа не подходит', () => {
    const day = '2026-11-09';
    const guessed = createHmac('sha256', day).update('203.0.113.7').digest('hex').slice(0, 16);
    expect(hashIp('203.0.113.7', new Date(`${day}T10:00:00Z`))).not.toBe(guessed);
  });

  it('длина настраивается, адрес в хэше не виден', () => {
    const h = hashIp('203.0.113.7', new Date(), 64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('203');
  });
});
