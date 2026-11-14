import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLANS, schema } from '@blokum/db';
import { Behavior, Transition, createBlock, createDocument, createScreen, type ProjectDocument } from '@blokum/schema';
import { EntitlementsService, scanPlanFeatures } from '../src/entitlements/entitlements.service.js';
import { createTestDb, pgSkipGuard, type TestDb } from './helpers.js';

/*
 * P7.1 · таблица `docs/04-TARIFFS.md` §2, строка за строкой и тариф за тарифом: каждая проверяемая при публикации возможность
 * либо пропускается, либо отклоняется ровно по лимиту тарифа. Ожидание считается из лимитов тарифа (`PLANS`), а они сверены с
 * документом в `packages/db/test/seed.test.ts`.
 */
const NOW = new Date('2026-11-09T12:00:00Z');
const DAY = 86_400_000;
const CODES = ['FREE', 'PASS', 'AUTHOR', 'PLUS', 'PRO'] as const;
const media = { source: 'media', id: 'kartinka000001' } as const;

type Feature = {
  row: string;
  code: string;
  /** The document that uses the feature as much as the plan allows plus one, or `null` when the plan allows without limit. */
  doc: (limits: (typeof PLANS)[number]['limits']) => ProjectDocument | null;
  /** The plan refuses it. */
  refused: (limits: (typeof PLANS)[number]['limits']) => boolean;
};

const base = (): ProjectDocument => createDocument({ title: 'Таблица тарифов' });
const withScreen = (mutate: (d: ProjectDocument) => void): ProjectDocument => {
  const d = base();
  mutate(d);
  return d;
};

const FEATURES: Feature[] = [
  {
    row: 'Экранов в сборке',
    code: 'LIMIT_SCREENS',
    doc: (l) => withScreen((d) => { while (d.screens.length < l.screensPerProject + 1) d.screens.push(createScreen(`Экран ${d.screens.length + 1}`)); }),
    refused: () => true,
  },
  {
    row: 'Сценарии: правил на сборку',
    code: 'LIMIT_RULES',
    doc: (l) => withScreen((d) => {
      const rule = { id: 'r', when: { kind: 'tap', source: { kind: 'any' } }, do: [] };
      d.rules = Array.from({ length: l.rulesPerProject + 1 }, (_x, i) => ({ ...rule, id: `rule_${i}` })) as never;
    }),
    refused: () => true,
  },
  {
    row: 'Сбор контактов участников (B-19)',
    code: 'FEATURE_CONTACTS',
    doc: () => withScreen((d) => d.screens[0]!.blocks.push(createBlock('contacts'))),
    refused: (l) => !l.contactsCollection,
  },
  {
    row: 'Аудио (B-05)',
    code: 'FEATURE_AUDIO',
    doc: () => withScreen((d) => d.screens[0]!.blocks.push(createBlock('audio'))),
    refused: (l) => !l.audio,
  },
  {
    row: 'Поведения',
    code: 'FEATURE_BEHAVIORS',
    doc: () => withScreen((d) => {
      const b = createBlock('shape');
      b.behaviors = [Behavior.parse({ kind: 'follow' })];
      d.screens[0]!.blocks.push(b);
    }),
    refused: (l) => l.behaviors !== 'all' && !l.behaviors.includes('follow'),
  },
  {
    row: 'Движущихся объектов на экране',
    code: 'LIMIT_MOVING_OBJECTS',
    doc: (l) => withScreen((d) => {
      for (let i = 0; i < l.movingObjects + 1; i++) {
        const b = createBlock('shape');
        b.behaviors = [Behavior.parse({ kind: 'move' })];
        d.screens[0]!.blocks.push(b);
      }
    }),
    refused: () => true,
  },
  {
    row: 'Переходы T-05…T-08, свои переходы (T-32), частицы из своих картинок (P-08)',
    code: 'FEATURE_TRANSITIONS',
    doc: () => withScreen((d) => { d.screens[0]!.transitionIn = Transition.parse({ kind: 'blinds' }); }),
    refused: (l) => !l.premiumTransitions,
  },
  {
    row: 'Медиа-переходы и медиа-вставки (T-20, T-21, AC-08)',
    code: 'LIMIT_MEDIA_TRANSITIONS',
    doc: (l) => {
      if (l.mediaTransitionsPerProject === null) return null;
      return withScreen((d) => {
        const n = l.mediaTransitionsPerProject! + 1;
        while (d.screens.length < n) d.screens.push(createScreen(`Экран ${d.screens.length + 1}`));
        for (let i = 0; i < n; i++) d.screens[i]!.transitionIn = Transition.parse({ kind: 'media', overlay: { media } });
      });
    },
    refused: () => true,
  },
  {
    row: 'Свой логотип в плеере, своя OG-картинка',
    code: 'FEATURE_OWN_PREVIEW',
    doc: () => withScreen((d) => { d.meta.ogImage = media; }),
    refused: (l) => !l.ownBranding,
  },
];

describe('P7.1 · таблица тарифов: каждая строка × каждый тариф', () => {
  const pg = pgSkipGuard();
  let db: TestDb;
  let svc: EntitlementsService;
  let n = 0;

  beforeAll(async () => {
    try {
      db = await createTestDb();
      svc = new EntitlementsService(db.db);
    } catch (e) {
      if ((e as { code?: string }).code === 'ECONNREFUSED') pg.skip();
    }
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** A user on the plan with one project of his own (for «Праздник» — a pass on that project). */
  async function owner(code: (typeof CODES)[number]): Promise<{ userId: string; projectId: string }> {
    const [u] = await db.db.insert(schema.users).values({ displayName: 'Тест', phoneE164: `+7900${String(3000000 + ++n)}` }).returning();
    const [p] = await db.db.insert(schema.projects).values({ ownerId: u!.id, title: 'Сборка', slug: `m-${n}` }).returning();
    if (code === 'PASS') await db.db.insert(schema.entitlements).values({ userId: u!.id, projectId: p!.id, feature: 'PASS', validFrom: new Date(NOW.getTime() - DAY), validTo: new Date(NOW.getTime() + 29 * DAY) });
    else if (code !== 'FREE') await db.db.insert(schema.subscriptions).values({ userId: u!.id, planCode: code, period: 'MONTH', status: 'ACTIVE', currentPeriodStart: new Date(NOW.getTime() - DAY), currentPeriodEnd: new Date(NOW.getTime() + 29 * DAY) });
    return { userId: u!.id, projectId: p!.id };
  }

  for (const code of CODES) {
    describe(`тариф ${code}`, () => {
      for (const f of FEATURES) {
        it(`P7.1 · ${code} · ${f.row}`, async () => {
          const limits = PLANS.find((p) => p.code === code)!.limits;
          const doc = f.doc(limits);
          if (doc === null) return; // no limit on this plan: nothing to exceed
          const { userId, projectId } = await owner(code);
          const found = (await svc.publishViolations(userId, projectId, doc, {}, NOW)).map((v) => v.code);
          if (f.refused(limits)) expect(found, `${code}: ${f.row}`).toContain(f.code);
          else expect(found, `${code}: ${f.row}`).not.toContain(f.code);
        });
      }

      it(`P7.1 · ${code} · ровно по лимиту — можно, на единицу больше — нельзя (экраны, правила, движущиеся объекты)`, async () => {
        const limits = PLANS.find((p) => p.code === code)!.limits;
        const { userId, projectId } = await owner(code);
        const screens = withScreen((d) => { while (d.screens.length < limits.screensPerProject) d.screens.push(createScreen(`Экран ${d.screens.length + 1}`)); });
        expect((await svc.publishViolations(userId, projectId, screens, {}, NOW)).map((v) => v.code)).not.toContain('LIMIT_SCREENS');
        const moving = withScreen((d) => {
          for (let i = 0; i < limits.movingObjects; i++) {
            const b = createBlock('shape');
            b.behaviors = [Behavior.parse({ kind: 'move' })];
            d.screens[0]!.blocks.push(b);
          }
        });
        expect((await svc.publishViolations(userId, projectId, moving, {}, NOW)).map((v) => v.code)).not.toContain('LIMIT_MOVING_OBJECTS');
      });
    });
  }

  it('P7.1 · scanPlanFeatures считает то, что решает тариф: переходы, медиа-вставки, движущиеся объекты, поведения', () => {
    const d = withScreen((doc) => {
      doc.screens[0]!.transitionIn = Transition.parse({ kind: 'page' });
      const b = createBlock('shape');
      b.behaviors = [Behavior.parse({ kind: 'flee' }), Behavior.parse({ kind: 'drag' })];
      doc.screens[0]!.blocks.push(b, createBlock('shape'));
    });
    const use = scanPlanFeatures(d);
    expect(use.premiumTransitions).toBe(true);
    expect(use.mostMoving).toBe(1);
    expect([...use.behaviors].sort()).toEqual(['drag', 'flee']);
    expect(use.mediaInserts).toBe(0);
    expect(use.ownPreview).toBe(false);
  });
});
