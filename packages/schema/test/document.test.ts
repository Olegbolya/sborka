import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BLOCK_TYPES,
  DOCUMENT_LIMITS,
  MIGRATIONS,
  PRIVATE_FIELDS,
  ProjectDocument,
  Rule,
  Variable,
  assertDocumentSize,
  countRules,
  createBlock,
  createDocument,
  createRule,
  createScreen,
  migrateDocument,
  toPublicDocument,
  walkBlocks,
  type Block,
  type BlockType,
} from '../src/index.js';
import v0Draft from './fixtures/v0-draft.json' with { type: 'json' };

const tap = (blockId: string) => ({ kind: 'tap' as const, source: { kind: 'block' as const, blockId } });

describe('ограничения документа (02-ARCHITECTURE §4)', () => {
  it('новый документ проходит схему', () => {
    expect(ProjectDocument.safeParse(createDocument()).success).toBe(true);
  });

  it('больше 50 экранов — ошибка по-русски', () => {
    const doc = createDocument();
    doc.screens = Array.from({ length: DOCUMENT_LIMITS.screens + 1 }, (_, i) => createScreen(`Э${i}`));
    const r = ProjectDocument.safeParse(doc);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/50/);
  });

  it('больше 100 блоков на экране с учётом вложенных — ошибка', () => {
    const doc = createDocument();
    const box = createBlock('container', { children: Array.from({ length: 60 }, () => createBlock('shape')) });
    doc.screens[0]!.blocks = [box, ...Array.from({ length: 40 }, () => createBlock('shape'))];
    const r = ProjectDocument.safeParse(doc);
    expect(r.error?.issues.map((i) => i.message)).toContain('На экране «Экран 1» 101 блоков — можно не больше 100');
  });

  it('больше 1000 правил на документ (документ + экраны + блоки) — ошибка', () => {
    const doc = createDocument();
    const rule = () => createRule({ kind: 'screen', phase: 'show' }, [{ kind: 'finish' }]);
    doc.rules = Array.from({ length: 500 }, rule);
    doc.screens = Array.from({ length: 3 }, (_, i) => createScreen(`Э${i}`, { rules: Array.from({ length: 167 }, rule) }));
    expect(countRules(doc)).toBe(1001);
    const r = ProjectDocument.safeParse(doc);
    expect(r.error?.issues.map((i) => i.message)).toContain('В сборке 1001 правил — можно не больше 1000');
  });

  it('повторяющиеся идентификаторы экранов и блоков — ошибка', () => {
    const doc = createDocument();
    const b = createBlock('shape');
    doc.screens.push(createScreen('Второй', { id: doc.screens[0]!.id, blocks: [b, { ...b }] }));
    const msgs = ProjectDocument.safeParse(doc).error?.issues.map((i) => i.message) ?? [];
    expect(msgs).toContain(`Идентификатор «${doc.screens[0]!.id}» повторяется`);
    expect(msgs).toContain(`Идентификатор «${b.id}» повторяется`);
  });

  it('размер больше 3 МБ отклоняется, меньше — нет', () => {
    expect(() => assertDocumentSize(JSON.stringify(createDocument()))).not.toThrow();
    expect(() => assertDocumentSize('x'.repeat(DOCUMENT_LIMITS.bytes + 1))).toThrow('Сборка слишком большая: 3.0 МБ, можно не больше 3 МБ');
    // Кириллица считается в байтах UTF-8, а не в символах.
    expect(() => assertDocumentSize('я'.repeat(DOCUMENT_LIMITS.bytes / 2 + 1))).toThrow(RangeError);
  });

  it('ошибки схемы — на русском', () => {
    const r = ProjectDocument.safeParse({ schemaVersion: 1, screens: [] });
    const text = r.error?.issues.map((i) => i.message).join(' ') ?? '';
    expect(text).toMatch(/[а-яё]/i);
    expect(text).not.toMatch(/\b(expected|invalid|too small)\b/i);
  });
});

// ── Случайные документы ───────────────────────────────────────────────────────
const arbType = fc.constantFrom<BlockType>(...BLOCK_TYPES);
const arbScore = fc.integer({ min: -1000, max: 1000 });
const arbTags = fc.array(fc.constantFrom('снеговик', 'ёлка', 'олень', 'гном'), { maxLength: 3 });

/** A block of a random type; choice options get random keys, some blocks get a weighted wheel. */
const arbBlock = fc.record({ type: arbType, correct: fc.boolean(), score: arbScore, tags: arbTags, wheel: fc.boolean(), weight: fc.integer({ min: 0, max: 1000 }) }).map(
  ({ type, correct, score, tags, wheel, weight }): Block => {
    const b = createBlock(type);
    if (b.type === 'singleChoice' || b.type === 'multiChoice') {
      b.props.options = b.props.options.map((o, i) => ({ ...o, correct: i === 0 ? correct : !correct, score, resultTags: tags }));
    }
    if (wheel) {
      const sectors = [createBlock('shape'), createBlock('shape')];
      b.children.push(...sectors);
      b.behaviors = [{ kind: 'wheel', spinMs: 4000, sectors: sectors.map((s) => ({ blockId: s.id, weight })) }];
    }
    return b;
  },
);

const arbDocument = fc
  .array(fc.array(arbBlock, { maxLength: 6 }), { minLength: 1, maxLength: 5 })
  .chain((screens) =>
    fc.record({ title: fc.string({ minLength: 1, maxLength: 40 }), min: fc.integer({ min: -50, max: 0 }) }).map(({ title, min }) => {
      const doc = createDocument({ title });
      doc.screens = screens.map((blocks, i) => createScreen(`Экран ${i + 1}`, { blocks }));
      doc.results = [{ kind: 'scoreRange', id: 'result0001', key: 'итог', screenId: doc.screens[0]!.id, min, max: 100 }];
      return doc;
    }),
  );

const keysDeep = (value: unknown, acc = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, acc));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      keysDeep(v, acc);
    }
  }
  return acc;
};

describe('PL-15 · L-03 · RN-01: публичная проекция документа', () => {
  it('PL-15: на 1000 случайных документов в браузер не уходят ключ ответов, баллы, теги и веса', () => {
    fc.assert(
      fc.property(arbDocument, (doc) => {
        const pub = toPublicDocument(doc);
        const keys = keysDeep(pub);
        // «weight» — ещё и начертание шрифта, поэтому веса секторов проверяются отдельно ниже.
        for (const f of PRIVATE_FIELDS.filter((x) => x !== 'weight')) expect(keys.has(f)).toBe(false);
        for (const b of pub.screens.flatMap((sc) => [...walkBlocks(sc.blocks)])) {
          if (b.type === 'singleChoice' || b.type === 'multiChoice') {
            for (const o of b.props.options) expect(Object.keys(o).sort()).toEqual(['blockId', 'id']);
          }
          for (const bh of b.behaviors) {
            if (bh.kind === 'wheel') for (const s of bh.sectors) expect(Object.keys(s)).toEqual(['blockId']);
          }
        }
        expect(pub.results).toEqual([]);
        // Проекция остаётся валидным документом (участнику рендерится тот же экран).
        expect(ProjectDocument.safeParse(pub).success).toBe(true);
      }),
      { numRuns: 1000 },
    );
  }, 120_000);

  it('L-03: проекция не меняет исходный документ', () => {
    const doc = createDocument();
    const q = createBlock('singleChoice');
    if (q.type === 'singleChoice') q.props.options[0]!.correct = true;
    doc.screens[0]!.blocks = [q];
    const before = JSON.stringify(doc);
    toPublicDocument(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('сериализация JSON → разбор возвращает тот же документ (1000 случайных документов)', () => {
    fc.assert(
      fc.property(arbDocument, (doc) => {
        expect(ProjectDocument.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
      }),
      { numRuns: 1000 },
    );
  }, 120_000);
});

describe('миграции документа (02-ARCHITECTURE §4 п. 4)', () => {
  it('черновик версии 0 из test/fixtures приводится к текущей версии', () => {
    const doc = migrateDocument(v0Draft);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.screens.map((s) => s.blocks.length)).toEqual([0, 0]);
    expect(doc.meta.title).toBe('Новогодний квиз');
  });

  it('документ текущей версии проходит без изменений', () => {
    const doc = createDocument();
    expect(migrateDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('у каждой версии ниже текущей есть миграция', () => {
    expect(Object.keys(MIGRATIONS).map(Number)).toEqual([0]);
  });

  it('ошибки: не объект, версия новее редактора, нет миграции', () => {
    expect(() => migrateDocument(null)).toThrow('Документ сборки должен быть объектом');
    expect(() => migrateDocument([])).toThrow(TypeError);
    expect(() => migrateDocument({ schemaVersion: 7 })).toThrow('Сборка создана в более новой версии редактора (7); обновите страницу');
    expect(() => migrateDocument({ schemaVersion: 1 }, {}, 2)).toThrow('Нет миграции документа с версии 1');
  });

  it('цепочка миграций применяется по порядку', () => {
    const seen: number[] = [];
    const reg = {
      0: (d: Record<string, unknown>) => (seen.push(0), MIGRATIONS[0]!(d)),
      1: (d: Record<string, unknown>) => (seen.push(1), { ...d }),
    };
    expect(() => migrateDocument(v0Draft, reg, 2)).toThrow(); // версии 2 ещё нет в схеме
    expect(seen).toEqual([0, 1]);
  });
});

describe('SC-01 · VR-01: разбор сценариев', () => {
  it('SC-01: «Повторить» требует число повторов или условие', () => {
    const base = { id: 'rule000001', when: tap('blk0000001') };
    expect(Rule.safeParse({ ...base, do: [{ kind: 'repeat', do: [{ kind: 'finish' }] }] }).success).toBe(false);
    expect(Rule.safeParse({ ...base, do: [{ kind: 'repeat', times: 3, do: [{ kind: 'finish' }] }] }).success).toBe(true);
  });

  it('SC-01: условия и действия вкладываются друг в друга', () => {
    const r = Rule.parse({
      id: 'rule000001',
      when: tap('blk0000001'),
      do: [
        {
          kind: 'if',
          if: {
            kind: 'group',
            op: 'and',
            items: [{ kind: 'chance', percent: 50 }, { kind: 'group', op: 'not', items: [{ kind: 'chance', percent: 10 }] }],
          },
          then: [{ kind: 'repeat', times: 2, do: [{ kind: 'if', if: { kind: 'chance', percent: 1 }, then: [{ kind: 'finish' }], else: [] }] }],
          else: [],
        },
      ],
    });
    expect(r.do[0]?.kind).toBe('if');
  });

  it('VR-01: начальное значение должно подходить к типу переменной', () => {
    const v = { id: 'var0000001', name: 'счёт', type: 'number', initial: 'ноль' };
    const r = Variable.safeParse(v);
    expect(r.error?.issues[0]?.message).toBe('Начальное значение не подходит к типу переменной');
    expect(Variable.safeParse({ ...v, initial: 0 }).success).toBe(true);
    expect(Variable.safeParse({ ...v, type: 'list', initial: [1, 'а'] }).success).toBe(true);
    expect(Variable.safeParse({ ...v, type: 'bool', initial: 1 }).success).toBe(false);
  });
});
