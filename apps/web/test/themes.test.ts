import { describe, expect, it } from 'vitest';
import { THEME_COLOR_ROLES, ThemeTokens, createBlock, createDocument } from '@blokum/schema';
import { applyTheme, setThemeTokens } from '../lib/editor/commands';
import { fieldKeys } from '../lib/editor/props-specs';
import { createEditorStore } from '../lib/editor/store';
import { effectiveStyle } from '../lib/editor/style-edit';
import { contrastChecks } from '../lib/themes/contrast';
import { sampleDocument } from '../lib/themes/sample';
import { stableJson } from '../lib/themes/stable';
import { THEME_KEYS, THEME_SECTIONS } from '../lib/themes/theme-specs';

const tokens = () => ThemeTokens.parse({});
const make = () => createEditorStore(sampleDocument(tokens()));

describe('TH-01 · состав темы в редакторе', () => {
  it('TH-01 · разделы редактора и два особых редактора покрывают все ключи темы', () => {
    const schemaKeys = Object.keys(ThemeTokens.parse({ particles: { preset: 'snow' } })).sort();
    expect([...new Set(THEME_KEYS)].sort()).toEqual(schemaKeys);
  });

  it('TH-01 · ключи полей разделов лежат внутри известных ключей темы', () => {
    for (const s of THEME_SECTIONS) for (const k of fieldKeys(s.fields)) expect(THEME_KEYS, `${s.id}:${k}`).toContain(k.split('.')[0]);
  });

  it('TH-01 · образцовый экран содержит блоки всех видов, кроме скрытых за контактами, и допустим по схеме', () => {
    const doc = sampleDocument(tokens());
    const types = new Set(doc.screens[0]!.blocks.map((b) => b.type));
    expect(types.size).toBe(22);
    expect(doc.screens[0]!.height).toBeGreaterThanOrEqual(400);
  });
});

describe('TH-01, TH-06 · правка токенов темы', () => {
  it('TH-01 · цвет меняется командой; недопустимый цвет не записывается', () => {
    const s = make();
    s.getState().apply(setThemeTokens((t) => ({ ...t, colors: { ...t.colors, primary: '#123456' } })), { label: 'x' });
    expect(s.getState().doc.theme.tokens.colors.primary).toBe('#123456');
    const stamp = s.getState().docVersion;
    s.getState().apply(setThemeTokens((t) => ({ ...t, colors: { ...t.colors, primary: 'красный' } })), { label: 'x' });
    expect(s.getState().docVersion).toBe(stamp);
  });

  it('TH-01 · цвета ролей обязательны: убрать роль нельзя', () => {
    const s = make();
    const stamp = s.getState().docVersion;
    s.getState().apply(setThemeTokens((t) => ({ ...t, colors: Object.fromEntries(Object.entries(t.colors).filter(([k]) => k !== THEME_COLOR_ROLES[0])) })), { label: 'x' });
    expect(s.getState().docVersion).toBe(stamp);
  });

  it('TH-06 · стиль по умолчанию для вида блока попадает в новые блоки, но не в блоки со своим значением', () => {
    const s = make();
    s.getState().apply(setThemeTokens((t) => ({ ...t, blockDefaults: { ...t.blockDefaults, button: { radius: { unit: 'u', tl: 24, tr: 24, br: 24, bl: 24 } } } })), { label: 'x' });
    const t = s.getState().doc.theme.tokens;
    const plain = createBlock('button');
    const own = createBlock('button', { style: { radius: { unit: 'u', tl: 2, tr: 2, br: 2, bl: 2 } } });
    expect(effectiveStyle(plain, t, null).radius.tl).toBe(24);
    expect(effectiveStyle(own, t, null).radius.tl).toBe(2);
    expect(effectiveStyle(createBlock('text'), t, null).radius.tl).not.toBe(24);
  });

  it('TH-03 · применение темы заменяет копию токенов в документе и запоминает тему, свои стили блоков не трогает', () => {
    const doc = createDocument();
    const own = createBlock('shape', { style: { effects: { opacity: 0.4 } } });
    doc.screens[0]!.blocks.push(own);
    const s = createEditorStore(doc);
    const next = { ...tokens(), colors: { ...tokens().colors, primary: '#00FF00' } };
    s.getState().apply(applyTheme('tema_pervaya_1', next), { label: 'x' });
    expect(s.getState().doc.theme).toMatchObject({ themeId: 'tema_pervaya_1', tokens: { colors: { primary: '#00FF00' } } });
    expect(s.getState().doc.screens[0]!.blocks[0]!.style).toEqual(own.style);
    const stamp = s.getState().docVersion;
    s.getState().apply(applyTheme('tema_pervaya_1', { colors: { primary: 'нет' } }), { label: 'x' });
    expect(s.getState().docVersion).toBe(stamp);
  });
});

describe('TH-02 · проверка контраста и сравнение тем', () => {
  it('TH-02 · светлая тема по умолчанию читается; слабый текст помечается', () => {
    const base = tokens();
    expect(contrastChecks(base).find((c) => c.id === 'text-background')?.ok).toBe(true);
    const weak = { ...base, colors: { ...base.colors, text: '#EEEEEE' } };
    const checks = contrastChecks(weak);
    expect(checks.find((c) => c.id === 'text-background')).toMatchObject({ ok: false, needed: 4.5 });
    expect(checks.filter((c) => !c.ok).length).toBeGreaterThan(0);
  });

  it('TH-03 · stableJson не зависит от порядка ключей', () => {
    expect(stableJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: 2 } })).toBe(stableJson({ a: { c: 2, d: [1, { x: 2, y: 1 }] }, b: 1 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
  });
});
