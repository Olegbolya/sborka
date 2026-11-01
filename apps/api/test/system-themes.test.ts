import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@blokum/db';
import { SYSTEM_THEMES, SYSTEM_THEME_NAMES } from '@blokum/themes';
import { SystemThemesService } from '../src/themes/system-themes.service.js';
import { createTestDb, startTestApp, type TestApp, type TestDb } from './helpers.js';

/**
 * TH-05 · the API seeds the three starter system themes at startup, idempotently.
 * The administrator can still add more through AD-11 (see moderation.test.ts).
 */
describe('TH-05 · посев системных тем на старте API', () => {
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

  it('TH-05 · после запуска API в БД лежат три стартовые темы с нужными именами и isSystem=true', async () => {
    const rows = await db.db
      .select({ id: schema.themes.id, name: schema.themes.name, isSystem: schema.themes.isSystem, ownerId: schema.themes.ownerId })
      .from(schema.themes)
      .where(and(eq(schema.themes.isSystem, true), isNull(schema.themes.deletedAt)));
    const names = rows.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(SYSTEM_THEME_NAMES));
    expect(rows.length).toBe(SYSTEM_THEMES.length);
    for (const r of rows) {
      expect(r.isSystem).toBe(true);
      expect(r.ownerId).toBeNull();
    }
    for (const theme of SYSTEM_THEMES) {
      expect(rows.find((r) => r.id === theme.id)).toBeDefined();
    }
  });

  it('TH-05 · повторный вызов seed() не создаёт дубликатов (идемпотентность)', async () => {
    const service = t.app.get(SystemThemesService);
    const inserted = await service.seed();
    expect(inserted).toBe(0);
    const rows = await db.db
      .select({ id: schema.themes.id })
      .from(schema.themes)
      .where(and(eq(schema.themes.isSystem, true), isNull(schema.themes.deletedAt)));
    expect(rows.length).toBe(SYSTEM_THEMES.length);
  });

  it('TH-05 · если удалить одну стартовую тему, повторный seed() восстановит её', async () => {
    await db.db.delete(schema.themes).where(eq(schema.themes.id, 'sys-theme-light'));
    const service = t.app.get(SystemThemesService);
    const inserted = await service.seed();
    expect(inserted).toBe(1);
    const [restored] = await db.db
      .select({ name: schema.themes.name, isSystem: schema.themes.isSystem })
      .from(schema.themes)
      .where(eq(schema.themes.id, 'sys-theme-light'));
    expect(restored).toEqual({ name: 'Светлая нейтральная', isSystem: true });
  });

  it('TH-05 · токены темы в БД совпадают с данными пакета themes', async () => {
    const [row] = await db.db
      .select({ tokens: schema.themes.tokens })
      .from(schema.themes)
      .where(eq(schema.themes.id, 'sys-theme-newyear'));
    const expected = SYSTEM_THEMES.find((x) => x.id === 'sys-theme-newyear')!;
    // Server stores tokens as jsonb — defaults introduced by parsing should match the data.
    const colors = (row!.tokens as { colors?: Record<string, string> }).colors ?? {};
    expect(colors.background).toBe(expected.tokens.colors.background);
    expect(colors.primary).toBe(expected.tokens.colors.primary);
  });
});
