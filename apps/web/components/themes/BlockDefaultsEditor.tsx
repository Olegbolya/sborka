'use client';
import { BLOCK_TYPES, type Block, type BlockType, type ThemeTokens, createBlock } from '@blokum/schema';
import { useMemo, useState } from 'react';
import { setThemeTokens } from '../../lib/editor/commands';
import { type StyleGroup, effectiveStyle } from '../../lib/editor/style-edit';
import { GROUP_SPECS } from '../../lib/editor/style-specs';
import { CATALOG } from '../../lib/editor/props-specs';
import { Section, SelectInput, Toggle } from '../editor/controls';
import { useEditor } from '../editor/context';
import { GLOW_DEFAULT, Fields, type Level, groupsFor } from '../editor/StylePanels';

const TITLES: Record<string, string> = { ...Object.fromEntries(CATALOG.map((e) => [e.type, e.title])), consent: 'Согласие на обработку данных' };

const without = <T extends object>(obj: T, key: string): T => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key)) as T;

/** The value of a group a block of this type has by default in these tokens: the theme's own or the base look. */
function defaultOf(sample: Block, tokens: ThemeTokens, group: StyleGroup): unknown {
  return effectiveStyle(sample, tokens, null)[group];
}

function DefaultsGroup({ type, group, sample }: { type: BlockType; group: StyleGroup; sample: Block }) {
  const apply = useEditor((s) => s.apply);
  const tokens = useEditor((s) => s.doc.theme.tokens);
  const spec = GROUP_SPECS[group];
  const current = defaultOf(sample, tokens, group);
  const own = tokens.blockDefaults[type]?.[group] !== undefined;
  const write = (change: (current: unknown) => unknown) =>
    apply(
      setThemeTokens((t) => ({ ...t, blockDefaults: { ...t.blockDefaults, [type]: { ...(t.blockDefaults[type] ?? {}), [group]: change(defaultOf(sample, t, group)) } } })),
      { label: `Стиль «${TITLES[type] ?? type}»: ${spec.title}`, mergeKey: `default:${type}:${group}` },
    );
  const reset = () =>
    apply(
      setThemeTokens((t) => {
        const rest = without({ ...(t.blockDefaults[type] ?? {}) }, group);
        const defaults = { ...t.blockDefaults };
        if (Object.keys(rest).length === 0) delete defaults[type];
        else defaults[type] = rest;
        return { ...t, blockDefaults: defaults };
      }),
      { label: `Сбросить стиль «${TITLES[type] ?? type}»: ${spec.title}` },
    );
  const level: Level = { values: [current], write, tokens };

  if (group === 'glow') {
    const on = current !== undefined;
    return (
      <Section id={`default-${group}`} title={spec.title} own={own} onReset={reset} resetLabel="Сбросить">
        <Toggle control="default-glow#switch" label="Свечение" value={on} onChange={(v) => write(() => (v ? structuredClone(GLOW_DEFAULT) : undefined))} />
        {on && <Fields fields={spec.fields} level={level} prefix="default-glow" />}
      </Section>
    );
  }
  return (
    <Section id={`default-${group}`} title={spec.title} own={own} onReset={reset} resetLabel="Сбросить">
      <Fields fields={spec.fields} level={level} prefix={`default-${group}`} />
    </Section>
  );
}

/**
 * TH-01, TH-06 · the style every new block of a type starts with: the same controls as the inspector of a block.
 * A group changed here is «своё» of the theme; blocks that have no value of their own follow it.
 */
export function BlockDefaultsEditor() {
  const [type, setType] = useState<BlockType>('text');
  const sample = useMemo(() => createBlock(type), [type]);
  const groups = groupsFor(sample).filter((g) => g !== 'lockAspect' && g !== 'autoHeight');
  return (
    <div data-testid="block-defaults">
      <SelectInput<BlockType> control="defaults-type" label="Вид блока" value={type} options={BLOCK_TYPES.map((t) => [t, TITLES[t] ?? t] as const)} onChange={setType} />
      <p className="ed-hint">Эти значения получат все блоки такого вида, у которых нет своих. Блоки с изменениями «своё» не меняются.</p>
      {groups.map((g) => (
        <DefaultsGroup key={`${type}:${g}`} type={type} group={g} sample={sample} />
      ))}
    </div>
  );
}
