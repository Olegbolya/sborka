'use client';
import { type Block, type Color, type MediaRef, type ThemeTokens } from '@blokum/schema';
import { useState } from 'react';
import {
  type BlockState,
  STATE_TITLES,
  STYLE_GROUPS,
  editAnimation,
  type StyleGroup,
  common,
  effectiveStyle,
  isOwn,
  resetStyleGroup,
  same,
  setStyleGroup,
} from '../../lib/editor/style-edit';
import { ANIMATION_SPEC, EDGES, type Field, GROUP_SPECS, MEDIA_TYPES } from '../../lib/editor/style-specs';
import { ColorInput, NumberInput, Section, SelectInput, SliderInput, TextInput, Toggle } from './controls';
import { useEditor } from './context';
import { MediaField } from './MediaPicker';
import { OptionsEditor, ScreenField, VariableField } from './PropsFields';

/** The object (or value) one level of the tree stands for, in every selected block, and how to change it in all of them. */
export interface Level {
  values: unknown[];
  /** The blocks being edited, when the level is the properties of blocks (options of a question need them). */
  ids?: readonly string[];
  write: (change: (current: unknown) => unknown) => void;
  tokens: ThemeTokens;
}

/** A key may be a path through nested objects («labels.min»); an empty key is the object itself. */
const getIn = (obj: unknown, key: string): unknown =>
  key === ''
    ? obj
    : key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | null | undefined)?.[k], obj);
/** Sets the value at the path; an undefined value removes the key. */
const setIn = (obj: unknown, key: string, value: unknown): unknown => {
  if (key === '') return value;
  const [head, ...rest] = key.split('.') as [string, ...string[]];
  const base = { ...(obj as Record<string, unknown> | undefined) };
  const inner = rest.length > 0 ? setIn(base[head], rest.join('.'), value) : value;
  if (inner === undefined) delete base[head];
  else base[head] = inner;
  return base;
};
const join = (a: string, b: string): string => (a === '' ? b : b === '' ? a : `${a}.${b}`);

function child(level: Level, key: string): Level {
  return {
    values: level.values.map((v) => getIn(v, key)),
    ...(level.ids ? { ids: level.ids } : {}),
    write: (change) => level.write((cur) => setIn(cur, key, change(getIn(cur, key)))),
    tokens: level.tokens,
  };
}

function itemOf(level: Level, index: number): Level {
  return {
    values: level.values.map((v) => (v as unknown[] | undefined)?.[index]),
    ...(level.ids ? { ids: level.ids } : {}),
    write: (change) => level.write((cur) => (cur as unknown[]).map((x, i) => (i === index ? change(x) : x))),
    tokens: level.tokens,
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** One field of the table: a control for a number, a choice, a colour… in the object of this level. */
export function FieldView({ field, level, prefix }: { field: Field; level: Level; prefix: string }) {
  const id = join(prefix, field.key);
  const here = child(level, field.key);
  const shared = common(here.values);

  switch (field.t) {
    case 'num': {
      const props = {
        control: id,
        label: field.label,
        value: num(shared),
        min: field.min,
        max: field.max,
        step: field.step,
        scale: field.scale,
        suffix: field.suffix,
        onChange: (n: number) => here.write(() => n),
      };
      return field.slider && field.min !== undefined && field.max !== undefined ? (
        <SliderInput {...props} min={field.min} max={field.max} step={field.step ?? 1} />
      ) : (
        <NumberInput {...props} />
      );
    }
    case 'select':
      return (
        <SelectInput
          control={id}
          label={field.label}
          value={typeof shared === 'string' || typeof shared === 'number' ? String(shared) : null}
          options={field.options}
          onChange={(v) => here.write((cur) => (typeof cur === 'number' ? Number(v) : v))}
        />
      );
    case 'bool':
      return (
        <Toggle
          control={id}
          label={field.label}
          value={typeof shared === 'boolean' ? shared : null}
          onChange={(v) => here.write(() => v)}
        />
      );
    case 'color':
      return (
        <ColorInput
          control={id}
          label={field.label}
          value={(shared as Color | null) ?? null}
          tokens={level.tokens}
          onChange={(c) => here.write(() => c)}
        />
      );
    case 'text':
      return (
        <TextInput
          control={id}
          label={field.label}
          value={typeof shared === 'string' ? shared : null}
          max={field.max}
          onChange={(v) => here.write(() => v)}
        />
      );
    case 'point': {
      const keys = field.keys ?? null;
      const axes = (['x', 'y'] as const).map((axis, i) => {
        const source = keys ? child(level, keys[i]!) : child(here, axis);
        return { axis, source, control: keys ? join(prefix, keys[i]!) : `${id}` };
      });
      return (
        <div className="ed-grid" data-control={keys ? undefined : id}>
          {axes.map(({ axis, source, control }) => (
            <NumberInput
              key={axis}
              control={keys ? control : `${id}.${axis}`}
              label={`${field.label}: ${axis === 'x' ? 'X' : 'Y'}`}
              value={num(common(source.values))}
              min={0}
              max={1}
              step={1}
              scale={100}
              suffix="%"
              onChange={(n) => source.write(() => n)}
            />
          ))}
        </div>
      );
    }
    case 'media':
      return (
        <MediaField
          control={id}
          label={field.label}
          value={(shared as MediaRef | null) ?? null}
          kinds={field.kinds ?? ['IMAGE', 'GIF', 'VIDEO']}
          onChange={(ref) => here.write(() => ref)}
        />
      );
    case 'multi': {
      const current = Array.isArray(shared) ? (shared as string[]) : [];
      return (
        <div className="ed-field" data-control={id} role="group" aria-label={field.label}>
          <span>{field.label}</span>
          <div className="ed-actions">
            {field.options.map(([value, title]) => (
              <label key={value} className="ed-check">
                <input
                  type="checkbox"
                  checked={current.includes(value)}
                  onChange={(e) => {
                    const next = field.options
                      .map(([v]) => v)
                      .filter((v) => (v === value ? e.target.checked : current.includes(v)));
                    if (next.length > 0) here.write(() => next);
                  }}
                />
                <span>{title}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    case 'variable':
      return (
        <VariableField
          control={id}
          label={field.label}
          optional={field.optional ?? false}
          value={typeof shared === 'string' ? shared : null}
          onChange={(v) => here.write(() => v)}
        />
      );
    case 'screen':
      return <ScreenField control={id} label={field.label} value={typeof shared === 'string' ? shared : null} onChange={(v) => here.write(() => v)} />;
    case 'choiceOptions':
      return <OptionsEditor ids={level.ids ?? []} />;
    case 'edges': {
      const current = Array.isArray(shared) ? (shared as string[]) : [];
      return (
        <div className="ed-field" data-control={id} role="group" aria-label={field.label}>
          <span>{field.label}</span>
          <div className="ed-actions">
            {EDGES.map(([edge, title]) => (
              <label key={edge} className="ed-check">
                <input
                  type="checkbox"
                  checked={current.includes(edge)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...current, edge] : current.filter((x) => x !== edge);
                    if (next.length > 0) here.write(() => next);
                  }}
                />
                <span>{title}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    case 'numlist': {
      const list = Array.isArray(shared) ? (shared as number[]) : [];
      return (
        <div className="ed-field" data-control={id}>
          <span>{field.label}</span>
          <div className="ed-actions">
            {list.map((n, i) => (
              <input
                key={i}
                type="number"
                aria-label={`${field.label} ${i + 1}`}
                min={0}
                max={field.maxValue}
                value={n}
                style={{ width: 56 }}
                onChange={(e) =>
                  Number.isFinite(e.target.valueAsNumber) &&
                  here.write(() =>
                    list.map((x, j) => (j === i ? Math.min(field.maxValue, Math.max(0, e.target.valueAsNumber)) : x)),
                  )
                }
              />
            ))}
            <button
              type="button"
              className="ed-btn small"
              disabled={list.length >= field.max}
              onClick={() => here.write(() => [...list, 4])}
            >
              +
            </button>
            <button
              type="button"
              className="ed-btn small"
              disabled={list.length <= field.min}
              aria-label="Убрать последнее число"
              onClick={() => here.write(() => list.slice(0, -1))}
            >
              −
            </button>
          </div>
        </div>
      );
    }
    case 'optional': {
      const on = shared === null ? null : shared !== undefined;
      const mixedOn =
        level.values.some((v) => getIn(v, field.key) !== undefined) &&
        level.values.some((v) => getIn(v, field.key) === undefined);
      return (
        <div className="ed-layer" data-control={field.fields.every((f) => f.key === '') ? id : undefined}>
          <Toggle
            control={`${id}#switch`}
            label={field.label}
            value={mixedOn ? null : on === true || (shared !== undefined && shared !== null)}
            onChange={(v) =>
              level.write((cur) => {
                return setIn(cur, field.key, v ? field.make() : undefined);
              })
            }
          />
          {shared !== undefined && shared !== null && <Fields fields={field.fields} level={here} prefix={id} />}
        </div>
      );
    }
    case 'variant': {
      const kinds = here.values.map((v) => (getIn(v, 'kind') as string | undefined) ?? null);
      const kind = common(kinds);
      const options = Object.entries(field.variants).map(([k, v]) => [k, v.title] as const);
      const spec = kind ? field.variants[kind] : undefined;
      return (
        <div className="ed-layer-fields">
          <SelectInput
            control={join(id, 'kind')}
            label={field.label}
            value={kind}
            options={options}
            onChange={(k) => here.write(() => field.variants[k]!.make())}
          />
          {spec && <Fields fields={spec.fields} level={here} prefix={id} />}
        </div>
      );
    }
    case 'list': {
      const lists = here.values as Array<unknown[] | undefined>;
      if (!same(lists[0], common(lists)) || common(lists) === null) {
        return (
          <div className="ed-field" data-control={id}>
            <span>{field.label}</span>
            <p className="ed-hint">У выбранных блоков разные значения.</p>
            <button
              type="button"
              className="ed-btn small"
              onClick={() => here.write(() => structuredClone(lists[0] ?? []))}
            >
              Задать одинаково, как у первого
            </button>
          </div>
        );
      }
      const items = lists[0] ?? [];
      const move = (from: number, to: number) =>
        here.write((cur) => {
          const next = [...(cur as unknown[])];
          const [x] = next.splice(from, 1);
          next.splice(to, 0, x);
          return next;
        });
      return (
        <div className="ed-field" data-control={id === '' ? undefined : id} role="group" aria-label={field.label}>
          {items.map((_, i) => (
            <div key={i} className="ed-layer" data-item={i}>
              <div className="ed-layerhead">
                <strong>
                  {field.label}: {i + 1}
                </strong>
                <button
                  type="button"
                  className="ed-btn small"
                  aria-label={`${field.label} ${i + 1}: выше`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ed-btn small"
                  aria-label={`${field.label} ${i + 1}: ниже`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="ed-btn small danger"
                  aria-label={`${field.label} ${i + 1}: убрать`}
                  disabled={items.length <= field.min}
                  onClick={() => here.write((cur) => (cur as unknown[]).filter((_x, j) => j !== i))}
                >
                  Убрать
                </button>
              </div>
              <Fields fields={field.item} level={itemOf(here, i)} prefix={id} />
            </div>
          ))}
          <button
            type="button"
            className="ed-btn small"
            disabled={items.length >= field.max}
            onClick={() => here.write((cur) => [...((cur as unknown[] | undefined) ?? []), field.make()])}
          >
            Добавить
          </button>
        </div>
      );
    }
  }
}

export function Fields({ fields, level, prefix }: { fields: Field[]; level: Level; prefix: string }) {
  return (
    <>
      {fields.map((f, i) => (
        <FieldView key={`${f.key}${i}`} field={f} level={level} prefix={prefix} />
      ))}
    </>
  );
}

/** Which groups make sense for a block (S-00: all of them for every type; media settings only where there is a file, layout only where there are inner blocks). */
export function groupsFor(block: Pick<Block, 'type' | 'children'>): StyleGroup[] {
  return STYLE_GROUPS.filter((g) => {
    if (g === 'media') return (MEDIA_TYPES as readonly string[]).includes(block.type);
    if (g === 'layout')
      return block.children.length > 0 || ['container', 'singleChoice', 'multiChoice'].includes(block.type);
    return true;
  });
}

const GLOW_DEFAULT = { color: { token: 'accent', alpha: 1 }, size: 16 };

/** One style group as a section of the panel. */
function GroupSection({ group, blocks, state }: { group: StyleGroup; blocks: Block[]; state: BlockState | null }) {
  const apply = useEditor((s) => s.apply);
  const tokens = useEditor((s) => s.doc.theme.tokens);
  const ids = blocks.map((b) => b.id);
  const spec = GROUP_SPECS[group];
  const values = blocks.map((b) => effectiveStyle(b, tokens, state)[group] as unknown);
  const own = blocks.some((b) => isOwn(b, group, state));
  const write = (change: (current: unknown) => unknown) =>
    apply(setStyleGroup(ids, group, tokens, state, change as never), {
      label: spec.title,
      mergeKey: `style:${group}:${state ?? ''}:${ids.join(',')}`,
    });
  const level: Level = { values, write, tokens };
  const reset = () => apply(resetStyleGroup(ids, [group], state), { label: `Сбросить к теме: ${spec.title}` });

  if (group === 'glow') {
    const on = values.every((v) => v !== undefined) ? true : values.every((v) => v === undefined) ? false : null;
    return (
      <Section id="glow" title={spec.title} own={own} onReset={reset}>
        <Toggle
          control="glow#switch"
          label="Свечение"
          value={on}
          onChange={(v) => write(() => (v ? structuredClone(GLOW_DEFAULT) : undefined))}
        />
        {on === true && <Fields fields={spec.fields} level={level} prefix="glow" />}
      </Section>
    );
  }
  return (
    <Section id={group} title={spec.title} own={own} onReset={reset}>
      <Fields fields={spec.fields} level={level} prefix={group} />
    </Section>
  );
}

const STATE_ORDER = Object.keys(STATE_TITLES) as BlockState[];

/**
 * «Оформление» (E-15, P3.4): every style group of the selected blocks, with the mark «своё» and «Сбросить к теме»
 * (TH-06), and the choice of the state the changes go to (S-15). Several blocks: what they share, the rest is «смешанно».
 */
export function StyleInspector({ blocks }: { blocks: Block[] }) {
  const [state, setState] = useState<BlockState | null>(null);
  const groups = STYLE_GROUPS.filter((g) => blocks.every((b) => groupsFor(b).includes(g)));
  // «Размер» holds two switches that are separate groups in the schema.
  const shown = groups.filter((g) => g !== 'lockAspect');
  return (
    <div data-testid="style-inspector">
      <div className="ed-section">
        <SelectInput<string>
          control="state"
          label="Состояние блока"
          value={state ?? 'normal'}
          options={[['normal', 'Обычное'], ...STATE_ORDER.map((s) => [s, STATE_TITLES[s]] as const)]}
          onChange={(v) => setState(v === 'normal' ? null : (v as BlockState))}
        />
        {state && <p className="ed-hint">Изменения ниже действуют только в состоянии «{STATE_TITLES[state]}».</p>}
      </div>
      {shown.map((g) =>
        g === 'autoHeight' ? (
          <SizeSection key="size" blocks={blocks} state={state} />
        ) : (
          <GroupSection key={g} group={g} blocks={blocks} state={state} />
        ),
      )}
    </div>
  );
}

function SizeSection({ blocks, state }: { blocks: Block[]; state: BlockState | null }) {
  const apply = useEditor((s) => s.apply);
  const tokens = useEditor((s) => s.doc.theme.tokens);
  const ids = blocks.map((b) => b.id);
  const flag = (group: 'autoHeight' | 'lockAspect', label: string) => (
    <Toggle
      control={group}
      label={label}
      value={common(blocks.map((b) => effectiveStyle(b, tokens, state)[group]))}
      onChange={(v) =>
        apply(
          setStyleGroup(ids, group, tokens, state, () => v),
          { label },
        )
      }
    />
  );
  return (
    <Section
      id="size"
      title="Размер"
      own={blocks.some((b) => isOwn(b, 'autoHeight', state) || isOwn(b, 'lockAspect', state))}
      onReset={() =>
        apply(resetStyleGroup(ids, ['autoHeight', 'lockAspect'], state), { label: 'Сбросить к теме: Размер' })
      }
    >
      {flag('lockAspect', 'Сохранять пропорции')}
      {flag('autoHeight', 'Автовысота по содержимому')}
    </Section>
  );
}

/** S-12…S-14 · animations of the selected blocks. */
export function AnimationInspector({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const tokens = useEditor((s) => s.doc.theme.tokens);
  const ids = blocks.map((b) => b.id);
  const level: Level = {
    values: blocks.map((b) => b.animation ?? {}),
    write: (change) =>
      apply(editAnimation(ids, change as never), { label: 'Анимация', mergeKey: `animation:${ids.join(',')}` }),
    tokens,
  };
  const own = blocks.some((b) => b.animation !== undefined);
  return (
    <Section
      id="animation"
      title="Анимации"
      own={own}
      resetLabel="Убрать"
      onReset={() =>
        apply(
          editAnimation(ids, () => ({})),
          { label: 'Убрать анимации' },
        )
      }
      open={own}
    >
      <Fields fields={ANIMATION_SPEC} level={level} prefix="" />
    </Section>
  );
}
