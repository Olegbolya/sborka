import { describe, expect, it } from 'vitest';
import { dateTime, remainingText, rubles } from '../lib/admin/format';

describe('AD-03 · сроки и подписи админки', () => {
  it('AD-03: срок жалобы — сколько осталось и насколько просрочено', () => {
    expect(remainingText(45 * 60_000)).toBe('осталось 45 мин');
    expect(remainingText(30_000)).toBe('осталось 1 мин');
    expect(remainingText(3 * 3_600_000 + 5 * 60_000)).toBe('осталось 3 ч 5 мин');
    expect(remainingText(72 * 3_600_000)).toBe('осталось 3 дн.');
    expect(remainingText(-2 * 3_600_000)).toBe('просрочено на 2 ч 0 мин');
    expect(remainingText(-10 * 60_000)).toBe('просрочено на 10 мин');
  });

  it('AD-02: деньги и даты — по-русски, дата без значения — прочерк', () => {
    expect(rubles(49000)).toBe('490 ₽');
    expect(rubles(49050)).toMatch(/^490,5 ₽$/);
    expect(dateTime(null)).toBe('—');
    expect(dateTime('2026-10-28T09:05:00Z')).toBe('28.10.2026, 12:05');
  });
});
