import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce, permissionsPolicy, securityHeaders } from '../lib/security-headers';

describe('N-04 · заголовки безопасности', () => {
  it('N-04: строгая политика — nonce, без unsafe-eval и unsafe-inline у скриптов, ничего не встраивается чужим', () => {
    const csp = contentSecurityPolicy({ nonce: 'abc' });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("style-src-elem 'self' 'nonce-abc'");
    for (const d of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"]) expect(csp).toContain(d);
  });

  it('N-04: в разработке разрешён eval, в рабочей среде — нет; медиа-домен добавляется к картинкам, звуку и видео', () => {
    expect(contentSecurityPolicy({ nonce: 'a', development: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ nonce: 'a' })).not.toContain("'unsafe-eval'");
    const csp = contentSecurityPolicy({ nonce: 'a', mediaOrigin: 'https://media.blokum.ru' });
    expect(csp).toContain("img-src 'self' data: blob: https://media.blokum.ru");
    expect(csp).toContain("media-src 'self' blob: https://media.blokum.ru");
    expect(csp).not.toMatch(/script-src[^;]*media\.blokum\.ru/);
  });

  it('N-04: датчики движения — только у плеера и редактора, остальное выключено везде', () => {
    expect(permissionsPolicy('/s/abc')).toContain('accelerometer=(self)');
    expect(permissionsPolicy('/q/abc')).toContain('gyroscope=(self)');
    expect(permissionsPolicy('/app/projects/x/edit')).toContain('accelerometer=(self)');
    expect(permissionsPolicy('/account')).toContain('accelerometer=()');
    for (const p of ['/', '/s/abc']) expect(permissionsPolicy(p)).toMatch(/camera=\(\), microphone=\(\), geolocation=\(\)/);
  });

  it('N-04: nonce у каждого запроса свой и не короче 16 байт', () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(atob(a).length).toBe(16);
    expect(securityHeaders('/', { nonce: a })['X-Content-Type-Options']).toBe('nosniff');
  });

  it('N-06: страница не берёт ничего с чужих адресов — только свой сайт и, если задан, медиа-домен', () => {
    const csp = contentSecurityPolicy({ nonce: 'a', mediaOrigin: 'https://media.blokum.ru' });
    const hosts = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(hosts).toEqual(['https://media.blokum.ru', 'https://media.blokum.ru', 'https://media.blokum.ru', 'https://media.blokum.ru']);
    expect(contentSecurityPolicy({ nonce: 'a' })).not.toMatch(/https?:\/\//);
  });
});
