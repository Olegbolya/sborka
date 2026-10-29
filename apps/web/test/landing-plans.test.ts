import { describe, expect, it } from 'vitest';
import { PLANS } from '../../../packages/db/src/plans';
import { describePlan, formatBytes, formatDays, plural, priceLine, type PlanView } from '../lib/landing/plans';

const view = (code: string): PlanView => {
  const p = PLANS.find((x) => x.code === code)!;
  return { code: p.code, title: p.title, priceMonthRub: p.priceMonthRub, priceYearRub: p.priceYearRub, priceOnceRub: p.priceOnceRub, limits: p.limits };
};

describe('P10.1 · тарифы на сайте читаются из лимитов', () => {
  it('P10.1 · цены: бесплатно, разово, в месяц и в год', () => {
    expect(priceLine(view('FREE'))).toEqual({ main: '0\u00a0₽', extra: 'навсегда' });
    expect(priceLine(view('PASS')).main).toBe('249\u00a0₽');
    expect(priceLine(view('PASS')).extra).toContain('разово');
    expect(priceLine(view('PLUS'))).toEqual({ main: '349\u00a0₽', extra: 'в месяц, или 2\u00a0990\u00a0₽ в год' });
  });

  it('P10.1 · описание бесплатного тарифа называет лимиты и водяной знак; бизнеса — оплату по счёту', () => {
    const free = describePlan(view('FREE')).join('|');
    expect(free).toContain('3\u00a0сборки одновременно');
    expect(free).toContain('100\u00a0прохождений в месяц');
    expect(free).toContain('Водяной знак');
    const biz = describePlan(view('BUSINESS')).join('|');
    expect(biz).toContain('Оплата по счёту');
    expect(biz).toContain('Без водяного знака');
    expect(biz).toContain('Сборок одновременно — сколько нужно');
  });

  it('P10.1 · единицы по-русски', () => {
    expect([1, 2, 5, 11, 21].map((n) => plural(n, 'день', 'дня', 'дней'))).toEqual(['день', 'дня', 'дней', 'дней', 'день']);
    expect(formatBytes(200 * 1024 ** 2)).toBe('200\u00a0МБ');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5\u00a0ГБ');
    expect(formatDays(1095)).toBe('3\u00a0года');
    expect(formatDays(30)).toBe('30\u00a0дней');
  });
});
