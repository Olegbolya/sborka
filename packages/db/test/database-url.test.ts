import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from '../src/index.js';

describe('DATABASE_URL', () => {
  it('разбирает корректный адрес', () => {
    expect(parseDatabaseUrl('postgresql://blokum:secret@127.0.0.1:5433/blokum_db?schema=public')).toEqual({
      host: '127.0.0.1',
      port: 5433,
      database: 'blokum_db',
      user: 'blokum',
    });
  });

  it('порт по умолчанию — 5432', () => {
    expect(parseDatabaseUrl('postgres://u@127.0.0.1/db').port).toBe(5432);
  });

  it.each([
    [undefined, 'Не задана'],
    ['', 'Не задана'],
    ['не адрес', 'не является корректным'],
    ['mysql://u@127.0.0.1/db', 'postgresql://'],
    ['postgresql://u@localhost/db', '127.0.0.1'],
    ['postgresql://u@127.0.0.1/', 'имя базы'],
    ['postgresql://127.0.0.1/db', 'пользователь'],
  ])('отклоняет %s', (raw, message) => {
    expect(() => parseDatabaseUrl(raw)).toThrow(message);
  });
});
