import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Db, withTransaction } from '../src/client.js';
import { users } from '../src/schema/index.js';
import { createTestDb, type TestDb } from './helpers.js';

const fakeDb = (impl: () => unknown) => ({ transaction: vi.fn(impl) }) as unknown as Pick<Db, 'transaction'>;

describe('withTransaction', () => {
  it('повторяет при конфликте сериализации и взаимоблокировке', async () => {
    let calls = 0;
    const db = fakeDb(() => {
      calls++;
      if (calls === 1) return Promise.reject(Object.assign(new Error('serialization'), { code: '40001' }));
      if (calls === 2) return Promise.reject(Object.assign(new Error('wrapped'), { cause: { code: '40P01' } }));
      return Promise.resolve('готово');
    });
    await expect(withTransaction(db, () => Promise.resolve('x'))).resolves.toBe('готово');
    expect(calls).toBe(3);
  });

  it('сдаётся после исчерпания попыток', async () => {
    const db = fakeDb(() => Promise.reject(Object.assign(new Error('serialization'), { code: '40001' })));
    await expect(withTransaction(db, () => Promise.resolve('x'), { retries: 2 })).rejects.toThrow('serialization');
    expect(db.transaction).toHaveBeenCalledTimes(3);
  });

  it('другие ошибки не повторяет', async () => {
    const db = fakeDb(() => Promise.reject(Object.assign(new Error('unique'), { code: '23505' })));
    await expect(withTransaction(db, () => Promise.resolve('x'))).rejects.toThrow('unique');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  describe('на настоящей базе', () => {
    let t: TestDb;
    beforeAll(async () => {
      t = await createTestDb();
    });
    afterAll(async () => {
      await t.drop();
    });

    it('при ошибке внутри откатывает все изменения', async () => {
      await expect(
        withTransaction(t.db, async (tx) => {
          await tx.insert(users).values({ id: 'rollbackuser01', displayName: 'Откат' });
          throw new Error('сбой посередине');
        }),
      ).rejects.toThrow('сбой посередине');
      expect(await t.db.select().from(users).where(eq(users.id, 'rollbackuser01'))).toHaveLength(0);
    });

    it('при успехе фиксирует изменения', async () => {
      const id = await withTransaction(t.db, async (tx) => {
        const [u] = await tx.insert(users).values({ displayName: 'Фиксация' }).returning();
        return u!.id;
      }, { isolationLevel: 'serializable' });
      expect(await t.db.select().from(users).where(eq(users.id, id))).toHaveLength(1);
    });
  });
});
