import { describe, expect, it } from 'vitest';
import { MASK, maskString, maskValue } from '../src/index.js';

describe('маскирование в тексте', () => {
  it.each([
    ['Звонок на +7 (999) 123-45-67', `+7${MASK}67`, '999'],
    ['телефон 89991234567', `+7${MASK}67`, '9991234'],
    ['+79991234567', `+7${MASK}67`, '99912345'],
    ['номер +380501234567', `+${MASK}67`, '0501234'],
  ])('телефон: «%s»', (input, kept, hidden) => {
    const out = maskString(input);
    expect(out).toContain(kept);
    expect(out).not.toContain(hidden);
  });

  it('e-mail: остаётся первая буква и домен', () => {
    expect(maskString('пишите ivanov.oleg@outlook.com')).toBe(`пишите i${MASK}@outlook.com`);
  });

  it('номер карты по Луну скрывается, последние 4 цифры остаются', () => {
    const out = maskString('оплата 4111 1111 1111 1111 прошла');
    expect(out).toContain(`карта ${MASK}1111`);
    expect(out).not.toContain('4111 1111');
  });

  it('длинное число, не похожее на карту, не трогается', () => {
    expect(maskString('заказ 1234567890123')).toBe('заказ 1234567890123');
  });

  it('коды из СМС и секреты в адресах', () => {
    expect(maskString('Ваш код: 482913')).toBe(`Ваш код: ${MASK}`);
    expect(maskString('verification code 7712')).toBe(`verification code ${MASK}`);
    expect(maskString('/callback?code=abc123&state=x')).toBe(`/callback?code=${MASK}&state=x`);
    expect(maskString('GET /x?token=eyJhbGci.payload.sig')).toBe(`GET /x?token=${MASK}`);
  });

  it('заголовок Authorization и длинные hex-строки', () => {
    expect(maskString('Authorization: Bearer abc.def-ghi')).toBe(`Authorization: Bearer ${MASK}`);
    expect(maskString(`сеанс ${'a1'.repeat(20)}`)).toBe(`сеанс ${MASK}`);
  });

  it('обычный текст и коды ошибок PostgreSQL не меняются', () => {
    expect(maskString('Сборка «Письмо Деду Морозу» опубликована, ошибка 23505')).toBe(
      'Сборка «Письмо Деду Морозу» опубликована, ошибка 23505',
    );
  });
});

describe('маскирование объектов', () => {
  it('скрывает значения секретных полей целиком и маскирует строки вглубь', () => {
    const out = maskValue({
      user: { phone: '+79991234567', email: 'a.b@mail.ru', name: 'Олег' },
      password: 'qwerty',
      sessionToken: 'abc',
      headers: { authorization: 'Bearer x', cookie: 'sid=1' },
      otp: '1234',
      list: ['+79990000011', 5, null],
      emptySecret: '',
    }) as Record<string, unknown>;
    expect(out).toMatchObject({
      password: MASK,
      sessionToken: MASK,
      otp: MASK,
      headers: { authorization: MASK, cookie: MASK },
      user: { name: 'Олег', email: `a${MASK}@mail.ru` },
      emptySecret: '',
    });
    expect(JSON.stringify(out)).not.toMatch(/99912345|qwerty|sid=1/);
    expect((out.list as unknown[])[1]).toBe(5);
  });

  it('ошибки: текст и стек маскируются, код сохраняется', () => {
    const e = Object.assign(new Error('не найден +79991234567'), { code: 'P404' });
    const out = maskValue(e) as Record<string, unknown>;
    expect(out.message).not.toContain('9991234');
    expect(out.code).toBe('P404');
    expect(out.type).toBe('Error');
  });

  it('циклические ссылки и очень глубокие объекты не ломают логирование', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(maskValue(a)).toMatchObject({ name: 'a', self: '[цикл]' });
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { deep };
    expect(JSON.stringify(maskValue(deep))).toContain('[глубоко]');
  });

  it('даты и примитивы возвращаются как есть', () => {
    const d = new Date('2026-10-20T00:00:00Z');
    expect(maskValue(d)).toBe(d);
    expect(maskValue(42)).toBe(42);
    expect(maskValue(undefined)).toBeUndefined();
  });
});
