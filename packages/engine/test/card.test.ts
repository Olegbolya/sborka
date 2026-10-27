import { describe, expect, it } from 'vitest';
import { createBlock } from '@blokum/schema';
import { FlowError, looksLikeCardNumber, normalizeAnswer } from '../src/index.js';

describe('TS-10 · ответы, похожие на номер карты', () => {
  it.each([
    ['4111111111111111'],
    ['4111 1111 1111 1111'],
    ['4111-1111-1111-1111'],
    ['моя карта 5555 5555 5555 4444, срок 12/30'],
    ['378282246310005'],
    ['6011111111111117'],
    ['4222222222222'],
    ['4111111111111111111'.slice(0, 16) + ' и ещё текст'],
  ])('TS-10 · «%s» признаётся номером карты', (text) => {
    expect(looksLikeCardNumber(text)).toBe(true);
  });

  it.each([['8 (900) 123-45-67'], ['+7 900 123 45 67'], ['4111 1111 1111 1112'], ['1234567890123'], ['12 апреля 2026, 14:30'], ['индекс 119991, дом 12, кв. 345'], ['']])('TS-10 · «%s» номером карты не признаётся', (text) => {
    expect(looksLikeCardNumber(text)).toBe(false);
  });

  it('TS-10, PL-13 · текстовый ответ и контакты с номером карты отклоняются сообщением по-русски; обычное проходит', () => {
    const q = createBlock('textInput');
    if (q.type !== 'textInput') throw new Error('тип');
    expect(() => normalizeAnswer(q, { kind: 'text', value: '4111 1111 1111 1111' })).toThrowError(/Похоже на номер карты/);
    try {
      normalizeAnswer(q, { kind: 'text', value: '4111111111111111' });
    } catch (e) {
      expect(e).toBeInstanceOf(FlowError);
      expect((e as FlowError).code).toBe('CARD_LIKE');
    }
    expect(normalizeAnswer(q, { kind: 'text', value: ' Привет ' })).toEqual({ kind: 'text', value: 'Привет' });
    const c = createBlock('contacts');
    if (c.type !== 'contacts') throw new Error('тип');
    expect(() => normalizeAnswer(c, { kind: 'contacts', values: { name: '5555555555554444' } })).toThrowError(/номер карты/);
    expect(normalizeAnswer(c, { kind: 'contacts', values: { name: 'Иван' } })).toEqual({ kind: 'contacts', values: { name: 'Иван' } });
  });
});
