import { describe, expect, it } from 'vitest';
import { outHref, parseOutTarget } from '../lib/play/out';

describe('PL-22, TS-12 · безопасный переход', () => {
  it('PL-22 · пропускает http, https (без логина в адресе), mailto и tel', () => {
    expect(parseOutTarget('https://example.ru/a?b=1')?.host).toBe('example.ru');
    expect(parseOutTarget('http://example.ru')).not.toBeNull();
    expect(parseOutTarget('mailto:a@example.ru')?.pathname).toBe('a@example.ru');
    expect(parseOutTarget('tel:+79001234567')).not.toBeNull();
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'file:///etc/passwd', 'https://user:pass@example.ru', '//example.ru', 'example.ru', '', null, undefined, `https://e.ru/${'a'.repeat(2000)}`]) {
      expect(parseOutTarget(bad as string)).toBeNull();
    }
  });

  it('TS-12 · ссылка из плеера ведёт на /out с закодированным адресом; недопустимая — никуда', () => {
    expect(outHref('https://example.ru/a?b=1&c=2')).toBe('/out?u=https%3A%2F%2Fexample.ru%2Fa%3Fb%3D1%26c%3D2');
    expect(outHref('javascript:alert(1)')).toBe('#');
  });
});
