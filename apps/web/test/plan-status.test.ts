import { describe, expect, it } from 'vitest';
import { daysLeft, daysLeftText } from '../components/account/PlanStatus';

describe('D-09 · сколько дней осталось у тарифа', () => {
  it('D-09 · часть дня считается целым днём; после конца срока — 0', () => {
    const now = new Date('2026-11-18T12:00:00Z');
    expect(daysLeft('2026-11-18T13:00:00Z', now)).toBe(1);
    expect(daysLeft('2026-11-21T12:00:00Z', now)).toBe(3);
    expect(daysLeft('2026-12-18T12:00:01Z', now)).toBe(31);
    expect(daysLeft('2026-11-17T12:00:00Z', now)).toBe(0);
  });

  it('D-09 · русские окончания: 1 день, 2 дня, 5 дней, 11 дней, 21 день, 22 дня', () => {
    expect(daysLeftText(1)).toBe('остался 1 день');
    expect(daysLeftText(2)).toBe('осталось 2 дня');
    expect(daysLeftText(5)).toBe('осталось 5 дней');
    expect(daysLeftText(11)).toBe('осталось 11 дней');
    expect(daysLeftText(14)).toBe('осталось 14 дней');
    expect(daysLeftText(21)).toBe('остался 21 день');
    expect(daysLeftText(22)).toBe('осталось 22 дня');
    expect(daysLeftText(0)).toBe('осталось 0 дней');
  });
});
