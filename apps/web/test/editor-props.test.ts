import { describe, expect, it } from 'vitest';
import { BLOCK_PROPS, BLOCK_TYPES, TRANSITION_KINDS, type BlockType, createBlock, createDocument, plainText } from '@blokum/schema';
import { SCREEN_KEYS, SCREEN_SECTIONS } from '../lib/editor/screen-specs';
import { addBlock, addOption, addVariable, moveOption, patchOption, removeOption, setBlockProps, setOptionText, setScreenProps } from '../lib/editor/commands';
import { CATALOG, PROP_SPECS, fieldKeys, propKeys } from '../lib/editor/props-specs';
import { createEditorStore } from '../lib/editor/store';
import { findBlock } from '../lib/editor/tree';

type Def = { type: string; innerType?: Def; element?: Def; shape?: Record<string, Def>; in?: Def };
const defOf = (t: unknown): Def => (t as { def: Def }).def;

/** Keys of the props the schema has: objects and lists of objects are opened, everything else is one value. */
function schemaKeys(type: unknown, prefix = ''): string[] {
  let d = defOf(type);
  while (['default', 'optional', 'nullable', 'prefault'].includes(d.type) && d.innerType) d = defOf(d.innerType);
  const join = (k: string) => (prefix === '' ? k : `${prefix}.${k}`);
  if (d.type === 'object' && d.shape) return Object.entries(d.shape).flatMap(([k, v]) => schemaKeys(v, join(k)));
  if (d.type === 'array' && d.element) {
    let e = defOf(d.element);
    while (['default', 'optional', 'nullable'].includes(e.type) && e.innerType) e = defOf(e.innerType);
    if (e.type === 'object' && e.shape) return Object.entries(e.shape).flatMap(([k, v]) => schemaKeys(v, join(k)));
  }
  return [prefix];
}

const setup = (type: BlockType) => {
  const doc = createDocument();
  const store = createEditorStore(doc);
  const screenId = doc.screens[0]!.id;
  let ids: string[] = [];
  store.getState().apply(addBlock(screenId, type, null, (c) => (ids = c)), { label: 'x' });
  const get = (id = ids[0]!) => findBlock(store.getState().doc, id)!.siblings[findBlock(store.getState().doc, id)!.index]!;
  return { store, screenId, ids, get };
};

describe('B-01…B-23 · свойства блоков', () => {
  it('B-00 · таблица свойств покрывает каждый ключ схемы props у всех 22 видов блоков', () => {
    for (const type of BLOCK_TYPES) {
      const have = new Set(propKeys(type));
      const want = schemaKeys(BLOCK_PROPS[type]).filter((k) => k !== '');
      if (type === 'scale') expect(want).toEqual(['variant', 'min', 'max', 'step', 'labels.min', 'labels.max', 'icons', 'required']);
      if (type === 'singleChoice') expect(want).toContain('options.resultTags');
      expect(want.filter((k) => !have.has(k)), type).toEqual([]);
      expect([...have].filter((k) => !want.includes(k)), type).toEqual([]);
    }
  });

  it('E-14 · в каталоге «Добавить» есть каждый вид блока, кроме согласия, которое приходит с контактами', () => {
    expect(CATALOG.map((e) => e.type).sort()).toEqual(BLOCK_TYPES.filter((t) => t !== 'consent').sort());
    expect(Object.keys(PROP_SPECS).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it('E-14 · каждый вид блока добавляется на экран и остаётся допустимым документом', () => {
    for (const type of BLOCK_TYPES) {
      const t = setup(type);
      expect(t.get().type).toBe(type);
      expect(BLOCK_PROPS[type].safeParse(t.get().props).success, type).toBe(true);
    }
  });

  it('B-19 · контактные данные приходят вместе с согласием на обработку персональных данных', () => {
    const t = setup('contacts');
    expect(t.ids).toHaveLength(2);
    expect(t.get(t.ids[1]).type).toBe('consent');
    expect(t.get(t.ids[1]).frame.y).toBeGreaterThanOrEqual(t.get().frame.y + t.get().frame.h);
  });

  it('E-14 · новый блок ложится под нижним, не наползая, и сверху по слоям', () => {
    const t = setup('shape');
    let second: string[] = [];
    t.store.getState().apply(addBlock(t.screenId, 'shape', null, (c) => (second = c)), { label: 'x' });
    const a = t.get(), b = t.get(second[0]);
    expect(b.frame.y).toBeGreaterThanOrEqual(a.frame.y + a.frame.h);
    expect(b.z).toBeGreaterThan(a.z);
  });

  it('B-21 · блок добавляется внутрь контейнера', () => {
    const t = setup('container');
    let inner: string[] = [];
    t.store.getState().apply(addBlock(t.screenId, 'button', t.ids[0]!, (c) => (inner = c)), { label: 'x' });
    expect(t.get().children.map((c) => c.id)).toEqual(inner);
  });

  it('B-08 · правка свойств проходит проверку схемы: допустимое применяется, недопустимое — нет', () => {
    const t = setup('timer');
    t.store.getState().apply(setBlockProps(t.ids, (p) => ({ ...p, seconds: 90 })), { label: 'x' });
    expect(t.get().props).toMatchObject({ seconds: 90 });
    const stamp = t.store.getState().docVersion;
    t.store.getState().apply(setBlockProps(t.ids, (p) => ({ ...p, seconds: 0 })), { label: 'x' });
    expect(t.get().props).toMatchObject({ seconds: 90 });
    expect(t.store.getState().docVersion).toBe(stamp);
  });

  it('B-11 · варианты: добавить, убрать (не меньше двух), переставить; блоки вариантов идут следом', () => {
    const t = setup('singleChoice');
    const q = () => t.get() as Extract<ReturnType<typeof t.get>, { type: 'singleChoice' }>;
    const ids = () => q().props.options.map((o) => o.id);
    t.store.getState().apply(addOption(t.ids[0]!), { label: 'x' });
    expect(q().props.options).toHaveLength(3);
    expect(q().children).toHaveLength(3);
    const [a, , c] = ids() as [string, string, string];
    t.store.getState().apply(moveOption(t.ids[0]!, 0, 2), { label: 'x' });
    expect(ids().at(-1)).toBe(a);
    const ys = q().props.options.map((o) => q().children.find((ch) => ch.id === o.blockId)!.frame.y);
    expect([...ys].sort((x, y) => x - y)).toEqual(ys);
    t.store.getState().apply(removeOption(t.ids[0]!, c), { label: 'x' });
    t.store.getState().apply(removeOption(t.ids[0]!, a), { label: 'x' });
    expect(q().props.options).toHaveLength(2);
    t.store.getState().apply(removeOption(t.ids[0]!, ids()[0]!), { label: 'x' });
    expect(q().props.options).toHaveLength(2);
    expect(q().children).toHaveLength(2);
  });

  it('B-11 · в вопросе с одним ответом правильный вариант один; баллы и метки записываются', () => {
    const t = setup('singleChoice');
    const q = () => t.get() as Extract<ReturnType<typeof t.get>, { type: 'singleChoice' }>;
    const o1 = q().props.options[0]!;
    const o2 = q().props.options[1]!;
    t.store.getState().apply(patchOption(t.ids[0]!, o1.id, { correct: true, score: 5, resultTags: [' лиса ', '', 'сова'] }), { label: 'x' });
    t.store.getState().apply(patchOption(t.ids[0]!, o2.id, { correct: true }), { label: 'x' });
    expect(q().props.options.map((o) => o.correct)).toEqual([false, true]);
    expect(q().props.options[0]).toMatchObject({ score: 5, resultTags: ['лиса', 'сова'] });
    t.store.getState().apply(setOptionText(t.ids[0]!, o1.id, 'Новый текст'), { label: 'x' });
    const drawn = q().children.find((c) => c.id === q().props.options[0]!.blockId)!;
    expect(plainText(drawn.textLayer!)).toBe('Новый текст');
  });

  it('B-12 · в вопросе с несколькими ответами правильных может быть несколько', () => {
    const t = setup('multiChoice');
    const q = () => t.get() as Extract<ReturnType<typeof t.get>, { type: 'multiChoice' }>;
    for (const o of q().props.options) t.store.getState().apply(patchOption(t.ids[0]!, o.id, { correct: true }), { label: 'x' });
    expect(q().props.options.every((o) => o.correct)).toBe(true);
  });

  it('VR-01 · новая переменная получает допустимое имя и не повторяет существующее', () => {
    const doc = createDocument();
    const store = createEditorStore(doc);
    let made = '';
    store.getState().apply(addVariable('очки', (id) => (made = id)), { label: 'x' });
    expect(store.getState().doc.variables.map((v) => v.name)).toEqual(['очки']);
    expect(made).toBe(store.getState().doc.variables[0]!.id);
    store.getState().apply(addVariable('очки'), { label: 'x' });
    store.getState().apply(addVariable('1 плохо'), { label: 'x' });
    expect(store.getState().doc.variables).toHaveLength(1);
  });

  it('B-13 · свойства каждого вида блока, заданные таблицей, дают допустимые значения по умолчанию', () => {
    for (const type of BLOCK_TYPES) expect(BLOCK_PROPS[type].safeParse(createBlock(type).props).success, type).toBe(true);
  });
});

describe('E-13, L-06 · свойства экрана', () => {
  const screenOf = () => {
    const doc = createDocument();
    const store = createEditorStore(doc);
    return { store, id: doc.screens[0]!.id, get: () => store.getState().doc.screens[0]! };
  };

  it('E-13 · разделы панели «Экран» покрывают ключи экрана, которые она задаёт', () => {
    const top = new Set(SCREEN_SECTIONS.flatMap((s) => fieldKeys(s.fields)).map((k) => k.split('.')[0]));
    expect([...top].sort()).toEqual([...SCREEN_KEYS].sort());
  });

  it('T-01 · для каждого вида перехода в панели есть вариант, и его значение по умолчанию допустимо', () => {
    const variant = SCREEN_SECTIONS.find((s) => s.id === 'transition')!.fields[0]!;
    if (variant.t !== 'variant') throw new Error('Ожидался выбор вида перехода');
    expect(Object.keys(variant.variants).sort()).toEqual([...TRANSITION_KINDS, 'media', 'preset'].sort());
    for (const [kind, v] of Object.entries(variant.variants)) {
      const t = screenOf();
      t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, transitionIn: v.make() })), { label: 'x' });
      expect((t.get().transitionIn as { kind: string }).kind, kind).toBe(kind);
    }
  });

  it('P-01 · частицы: включить, настроить, выключить; пресет «свои» без картинок не принимается', () => {
    const t = screenOf();
    const particles = SCREEN_SECTIONS.find((s) => s.id === 'particles')!.fields[0]!;
    if (particles.t !== 'optional') throw new Error('Ожидался переключатель частиц');
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, particles: particles.make() })), { label: 'x' });
    expect(t.get().particles).toMatchObject({ preset: 'snow', density: 0.5 });
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, particles: { ...(p.particles as object), preset: 'custom' } })), { label: 'x' });
    expect(t.get().particles?.preset).toBe('snow');
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, particles: undefined })), { label: 'x' });
    expect(t.get().particles).toBeUndefined();
  });

  it('L-06 · таймер экрана: включить, поставить секунды и переход по окончании', () => {
    const t = screenOf();
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, timer: { seconds: 45, onExpire: { kind: 'finish' } } })), { label: 'x' });
    expect(t.get().timer).toEqual({ seconds: 45, onExpire: { kind: 'finish' } });
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, timer: { seconds: 0, onExpire: { kind: 'next' } } })), { label: 'x' });
    expect(t.get().timer?.seconds).toBe(45);
  });

  it('E-13 · название не бывает пустым, высота держится в границах схемы, вид экрана меняется', () => {
    const t = screenOf();
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, name: '' })), { label: 'x' });
    expect(t.get().name).not.toBe('');
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, height: 100 })), { label: 'x' });
    expect(t.get().height).toBe(844);
    t.store.getState().apply(setScreenProps(t.id, (p) => ({ ...p, kind: 'result', height: 1200 })), { label: 'x' });
    expect(t.get()).toMatchObject({ kind: 'result', height: 1200 });
  });
});
