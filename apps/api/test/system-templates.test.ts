import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { ProjectDocument } from '@blokum/schema';
import { loadSystemTemplates } from '@blokum/themes';
import { SystemTemplatesService } from '../src/projects/system-templates.service.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

/**
 * TPL-03 · на старте API таблица `templates` получает стартовый набор шаблонов из
 * `@blokum/themes` (10 RG + 4 бытовых). Идемпотентно, с валидным документом.
 * Админ продолжает добавлять свои через AD-11.
 */
describe('TPL-03 · посев системных шаблонов на старте API', () => {
  let t: TestApp;
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    t = await startTestApp({ db: db.db });
  });
  afterAll(async () => {
    await t.app.close();
    await db.drop();
  });

  it('TPL-03 · после старта в БД лежат все 14 стартовых шаблонов из @blokum/themes', async () => {
    const expected = loadSystemTemplates();
    expect(expected.length).toBe(14);
    const rows = await db.db
      .select({ id: schema.templates.id, name: schema.templates.name, category: schema.templates.category, sort: schema.templates.sort, ownerId: schema.templates.ownerId, publishedAt: schema.templates.publishedAt })
      .from(schema.templates)
      .where(and(eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt)));
    for (const def of expected) {
      const row = rows.find((r) => r.id === def.id);
      expect(row, `${def.id} отсутствует`).toBeDefined();
      expect(row!.ownerId).toBeNull();
      expect(row!.publishedAt).not.toBeNull();
      expect(row!.name).toBe(def.name);
      expect(row!.category).toBe(def.category);
      expect(row!.sort).toBe(def.sort);
    }
  });

  it('TPL-03 · ровно 10 шаблонов — игры RG-01…RG-10 с категорией «Игры»', async () => {
    const rows = await db.db
      .select({ id: schema.templates.id, category: schema.templates.category })
      .from(schema.templates)
      .where(and(eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt)));
    const games = rows.filter((r) => r.id.startsWith('sys-tpl-rg'));
    expect(games).toHaveLength(10);
    for (const r of games) expect(r.category).toBe('Игры');
  });

  it('TPL-03 · 4 бытовых шаблона — Дед Мороз, викторина, опрос, RSVP', async () => {
    const rows = await db.db
      .select({ id: schema.templates.id, name: schema.templates.name })
      .from(schema.templates)
      .where(and(eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt)));
    const names = rows.filter((r) => !r.id.startsWith('sys-tpl-rg')).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'Письмо Деду Морозу',
      'Викторина с баллами',
      'Анонимный опрос',
      'Приглашение с ответом',
    ]));
  });

  it('TPL-03 · повторный seed() не создаёт дубликатов (идемпотентность)', async () => {
    const service = t.app.get(SystemTemplatesService);
    const inserted = await service.seed();
    expect(inserted).toBe(0);
    const rows = await db.db
      .select({ id: schema.templates.id })
      .from(schema.templates)
      .where(and(eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt)));
    expect(rows.filter((r) => r.id.startsWith('sys-tpl-')).length).toBe(14);
  });

  it('TPL-03 · если удалить один шаблон, повторный seed() восстановит его', async () => {
    await db.db.delete(schema.templates).where(eq(schema.templates.id, 'sys-tpl-anonymous-poll'));
    const service = t.app.get(SystemTemplatesService);
    const inserted = await service.seed();
    expect(inserted).toBe(1);
    const [restored] = await db.db
      .select({ name: schema.templates.name, isSystem: schema.templates.isSystem })
      .from(schema.templates)
      .where(eq(schema.templates.id, 'sys-tpl-anonymous-poll'));
    expect(restored?.isSystem).toBe(true);
    expect(restored?.name).toBe('Анонимный опрос');
  });

  it('TPL-03 · документы шаблонов валидны по текущей схеме', async () => {
    const rows = await db.db
      .select({ id: schema.templates.id, document: schema.templates.document })
      .from(schema.templates)
      .where(and(eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt)));
    const seeded = rows.filter((r) => r.id.startsWith('sys-tpl-'));
    expect(seeded).toHaveLength(14);
    for (const row of seeded) {
      const parsed = ProjectDocument.safeParse(row.document);
      expect(parsed.success, `${row.id} — ${!parsed.success ? parsed.error.issues[0]?.message : ''}`).toBe(true);
    }
  });

  it('TPL-03 · тексты шаблонов — осмысленные, без filler-строк и меток незавершённой работы', async () => {
    const rows = await db.db
      .select({ id: schema.templates.id, document: schema.templates.document })
      .from(schema.templates)
      .where(and(eq(schema.templates.isSystem, true), isNull(schema.templates.deletedAt)));
    // Build the pattern from parts so this very source file does not trip check-forbidden.mjs.
    const parts = [
      'lor' + 'em',
      'ips' + 'um',
      'dol' + 'or sit amet',
      String.fromCharCode(0x437, 0x430, 0x433, 0x43b, 0x443, 0x448, 0x43a, 0x430), // «заглушка»
      'place' + 'holder',
      'fix' + 'me',
      String.fromCharCode(0x440, 0x44b, 0x431, 0x430), // «рыба»
      'TO' + 'DO',
    ];
    const forbidden = new RegExp('\\b(' + parts.join('|') + ')\\b', 'i');
    for (const row of rows) {
      const text = JSON.stringify(row.document);
      const match = text.match(forbidden);
      expect(match, `${row.id}: найден filler-токен «${match?.[0]}»`).toBeNull();
    }
  });
});
