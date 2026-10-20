import { readFileSync } from 'node:fs';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS } from '../src/plans.js';
import { ProjectDocument, ThemeTokens, validateDocument } from '@blokum/schema';
import { DEV_SEED, devDoc, seedDevData, seedPlans } from '../src/seed.js';
import { libraryItems, participantSessions, plans, projectVersions, projects, templates, themes, users } from '../src/schema/index.js';
import { createTestDb, type TestDb } from './helpers.js';

const ORDER = ['FREE', 'PASS', 'PLUS', 'PRO', 'BUSINESS'] as const;
const tariffs = readFileSync(new URL('../../../docs/04-TARIFFS.md', import.meta.url), 'utf8');

/** Cells of a row of the main tariff table in docs/04-TARIFFS.md, by its first column. */
const row = (label: string): string[] => {
  const line = tariffs.split('\n').find((l) => l.startsWith(`| ${label} |`));
  if (!line) throw new Error(`В 04-TARIFFS.md нет строки «${label}»`);
  return line.split('|').slice(2, 7).map((c) => c.trim());
};
const firstNumber = (cell: string): number => Number((cell.match(/[\d\s]+/)?.[0] ?? '').replace(/\s/g, ''));
const bytes = (cell: string): number => {
  const n = Number(cell.match(/(\d+)/)?.[1]);
  return /ГБ/.test(cell) ? n * 1024 ** 3 : n * 1024 ** 2;
};
const days = (cell: string): number => {
  const n = Number(cell.match(/(\d+)/)?.[1]);
  return /год/.test(cell) ? n * 365 : n;
};

describe('тарифы в seed совпадают с docs/04-TARIFFS.md', () => {
  const plan = (code: (typeof ORDER)[number]) => PLANS.find((p) => p.code === code)!;

  it('цены', () => {
    const cells = row('Цена');
    expect(plan('FREE').priceMonthRub).toBe(0);
    expect(cells[1]).toContain(`${plan('PASS').priceOnceRub} ₽`);
    for (const [i, code] of (['PLUS', 'PRO', 'BUSINESS'] as const).entries()) {
      const p = plan(code);
      const cell = cells[i + 2]!.replace(/\s(?=\d{3})/g, '');
      expect(cell).toContain(`${p.priceMonthRub} ₽/мес`);
      expect(cell).toContain(`${p.priceYearRub} ₽/год`);
    }
  });

  it.each([
    ['Прохождений в месяц', 'completionsPerMonth', firstNumber],
    ['Экранов в сборке', 'screensPerProject', firstNumber],
    ['Сценарии: правил на сборку', 'rulesPerProject', firstNumber],
    ['Движущихся объектов на экране', 'movingObjects', firstNumber],
    ['Хранилище', 'storageBytes', bytes],
    ['Срок хранения ответов', 'answersRetentionDays', days],
  ] as const)('%s', (label, key, parse) => {
    const cells = row(label);
    ORDER.forEach((code, i) => {
      expect(plan(code).limits[key], `${code}: ${label}`).toBe(parse(cells[i]!));
    });
  });

  it('водяной знак только на «Старте»', () => {
    const cells = row('Водяной знак');
    ORDER.forEach((code, i) => expect(plan(code).limits.watermark).toBe(cells[i] === 'есть'));
  });
});

describe('seed', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.drop();
  });

  it('тарифы создаются и не перезаписываются при повторном запуске', async () => {
    expect(await seedPlans(t.db)).toBe(5);
    await t.db.update(plans).set({ priceMonthRub: 399 }).where(eq(plans.code, 'PLUS'));
    expect(await seedPlans(t.db)).toBe(0);
    const [plus] = await t.db.select().from(plans).where(eq(plans.code, 'PLUS'));
    expect(plus?.priceMonthRub).toBe(399);
  });

  it('тестовые данные загружаются и повторный запуск идемпотентен', async () => {
    await seedDevData(t.db, {});
    await seedDevData(t.db, {});
    const total = async (tbl: typeof users | typeof projects | typeof participantSessions) =>
      (await t.db.select({ value: count() }).from(tbl))[0]?.value;
    expect(await total(users)).toBe(2);
    expect(await total(projects)).toBe(3);
    expect(await total(participantSessions)).toBe(DEV_SEED.sessions);
    const ownThemes = await t.db.select().from(themes).where(eq(themes.ownerId, DEV_SEED.creatorId));
    expect(ownThemes).toHaveLength(1);
    const ownTemplates = await t.db.select().from(templates).where(eq(templates.ownerId, DEV_SEED.creatorId));
    expect(ownTemplates).toHaveLength(1);
  });

  it('системные темы, шаблоны и библиотека остаются пустыми', async () => {
    expect(await t.db.select().from(themes).where(eq(themes.isSystem, true))).toHaveLength(0);
    expect(await t.db.select().from(templates).where(eq(templates.isSystem, true))).toHaveLength(0);
    expect(await t.db.select().from(libraryItems)).toHaveLength(0);
  });

  it('документы тестовых сборок проходят схему и проверку логики без ошибок', async () => {
    const rows = await t.db.select({ document: projectVersions.document }).from(projectVersions);
    expect(rows).toHaveLength(3);
    for (const { document } of rows) {
      const doc = ProjectDocument.parse(document);
      expect(validateDocument(doc).filter((i) => i.severity === 'error')).toEqual([]);
    }
    expect(devDoc('Проверка', 3)).toEqual(devDoc('Проверка', 3)); // фиксированные id → идемпотентность
    const [theme] = await t.db.select({ tokens: themes.tokens }).from(themes).where(eq(themes.id, DEV_SEED.themeId));
    expect(ThemeTokens.safeParse(theme?.tokens).success).toBe(true);
  });

  it('в рабочей среде тестовые данные не загружаются', async () => {
    await expect(seedDevData(t.db, { NODE_ENV: 'production' })).rejects.toThrow('нельзя загружать в рабочую базу');
  });
});
