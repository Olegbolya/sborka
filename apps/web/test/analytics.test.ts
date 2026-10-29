import { describe, expect, it } from 'vitest';
import { analyticsAllowed, metrikaId, readConsent, writeConsent, CONSENT_KEY } from '../lib/analytics';
import { contentSecurityPolicy } from '../lib/security-headers';

describe('P10.7 · 05-LEGAL §2.2 · D8 · Метрика и cookie-согласие', () => {
  it('P10.7 · счётчик — только число из настроек; всё прочее не счётчик', () => {
    expect(metrikaId('12345678')).toBe('12345678');
    expect(metrikaId(' 98765432 ')).toBe('98765432');
    for (const bad of [undefined, '', 'abc', '12', '1234; alert(1)', '<script>']) expect(metrikaId(bad)).toBeNull();
  });

  it('P10.7 · на страницах плеера, ссылки наружу, админки и служебных галерей аналитики нет', () => {
    for (const p of ['/s/abc', '/s/abc/x', '/q/abc', '/out', '/admin', '/admin/reports', '/dev/behaviors']) expect(analyticsAllowed(p), p).toBe(false);
    for (const p of ['/', '/tariffs', '/help', '/examples', '/cabinet', '/app/projects/1/edit', '/legal/cookies']) expect(analyticsAllowed(p), p).toBe(true);
  });

  it('P10.7 · выбор хранится и читается; мусор и пустое хранилище означают «не выбрано»', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readConsent(storage)).toBeNull();
    writeConsent(storage, 'denied');
    expect(readConsent(storage)).toBe('denied');
    writeConsent(storage, 'granted');
    expect(readConsent(storage)).toBe('granted');
    mem.set(CONSENT_KEY, '{oops');
    expect(readConsent(storage)).toBeNull();
    mem.set(CONSENT_KEY, JSON.stringify({ analytics: 'maybe' }));
    expect(readConsent(storage)).toBeNull();
    expect(readConsent(null)).toBeNull();
  });

  it('P10.7 · политика страницы пускает к счётчику только когда он разрешён', () => {
    expect(contentSecurityPolicy({ nonce: 'n' })).not.toContain('mc.yandex.ru');
    const csp = contentSecurityPolicy({ nonce: 'n', analytics: true });
    expect(csp).toContain("img-src 'self' data: blob: https://mc.yandex.ru");
    expect(csp).toContain("connect-src 'self' https://mc.yandex.ru");
  });
});
