'use client';
import { type Block } from '@blokum/schema';
import { useEffect, useState } from 'react';
import { patchBlocks, renameScreen, setFrame, setScreenHeight } from '../../lib/editor/commands';
import { selectedBlocks } from '../../lib/editor/store';
import { useEditor } from './context';

/** A field whose value is shown as «смешанно» when the selected blocks differ (E-15). */
export function mixed<T>(values: readonly T[]): T | null {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0]! : null;
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number | null; onChange: (v: number) => void; min?: number; max?: number }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? '' : String(value));
  }, [value, focused]);
  return (
    <label className="ed-num">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={text}
        placeholder={value === null ? 'смешанно' : undefined}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function TextField({ label, value, onChange, max }: { label: string; value: string | null; onChange: (v: string) => void; max: number }) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      <input type="text" value={value ?? ''} placeholder={value === null ? 'смешанно' : undefined} maxLength={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** «Оформление»: place and size of the selected blocks (the other style groups arrive with P3.4). */
function Appearance({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const ids = blocks.map((b) => b.id);
  const field = (key: 'x' | 'y' | 'w' | 'h', label: string) => (
    <NumberField
      label={label}
      value={mixed(blocks.map((b) => b.frame[key]))}
      onChange={(v) => apply(setFrame(ids, { [key]: v }), { label: 'Положение и размер', mergeKey: `frame:${ids.join(',')}:${key}` })}
    />
  );
  return (
    <div className="ed-section">
      <h2>Положение и размер</h2>
      <div className="ed-grid">
        {field('x', 'X')}
        {field('y', 'Y')}
        {field('w', 'Ширина')}
        {field('h', 'Высота')}
      </div>
    </div>
  );
}

/** «Содержимое»: what the block is called and how it is announced to a screen reader. */
function Content({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const ids = blocks.map((b) => b.id);
  const single = blocks.length === 1 ? blocks[0]! : null;
  return (
    <div className="ed-section">
      <h2>Содержимое</h2>
      {single && (
        <TextField
          label="Название блока"
          value={single.name}
          max={60}
          onChange={(v) => v.trim() && apply(patchBlocks(ids, (b) => void (b.name = v.slice(0, 60))), { label: 'Название блока', mergeKey: `name:${single.id}` })}
        />
      )}
      <TextField
        label="Описание для скринридера"
        value={mixed(blocks.map((b) => b.a11y.alt ?? ''))}
        max={300}
        onChange={(v) => apply(patchBlocks(ids, (b) => void (b.a11y.alt = v || undefined)), { label: 'Описание для скринридера', mergeKey: `alt:${ids.join(',')}` })}
      />
    </div>
  );
}

/** «Сценарии»: what is attached to the selected blocks (editing rules arrives with P3.8). */
function Scenarios({ blocks }: { blocks: Block[] }) {
  const rules = blocks.reduce((n, b) => n + b.rules.length, 0);
  const behaviors = blocks.reduce((n, b) => n + b.behaviors.length, 0);
  return (
    <div className="ed-section">
      <h2>Сценарии</h2>
      <p className="ed-hint" data-testid="scenario-counts">
        Правил: {rules}. Поведений: {behaviors}.
      </p>
    </div>
  );
}

/** With nothing selected the right panel shows the current screen. */
function ScreenProps() {
  const apply = useEditor((s) => s.apply);
  const doc = useEditor((s) => s.doc);
  const screenId = useEditor((s) => s.selection.screenId);
  const screen = doc.screens.find((s) => s.id === screenId) ?? doc.screens[0]!;
  return (
    <div className="ed-section">
      <h2>Экран</h2>
      <TextField label="Название экрана" value={screen.name} max={80} onChange={(v) => apply(renameScreen(screen.id, v), { label: 'Название экрана', mergeKey: `screen-name:${screen.id}` })} />
      <NumberField label="Высота экрана" value={screen.height} min={400} max={5000} onChange={(v) => apply(setScreenHeight(screen.id, v), { label: 'Высота экрана', mergeKey: `screen-height:${screen.id}` })} />
      <p className="ed-hint">Выберите блок на экране или в слоях, чтобы изменить его.</p>
    </div>
  );
}

type Tab = 'look' | 'content' | 'scenarios';
const TABS: Array<[Tab, string]> = [
  ['look', 'Оформление'],
  ['content', 'Содержимое'],
  ['scenarios', 'Сценарии'],
];

/** E-15 · the right panel: «Оформление», «Содержимое», «Сценарии»; with several blocks selected — common values or «смешанно». */
export function Inspector() {
  const [tab, setTab] = useState<Tab>('look');
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const blocks = selectedBlocks({ doc, selection });
  return (
    <aside className="ed-panel right" aria-label="Свойства">
      <div className="ed-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" className="ed-tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {blocks.length === 0 ? (
        tab === 'look' ? (
          <ScreenProps />
        ) : (
          <div className="ed-section">
            <p className="ed-hint">Выберите блок, чтобы увидеть его свойства.</p>
          </div>
        )
      ) : (
        <div role="tabpanel" data-selected-count={blocks.length}>
          {tab === 'look' && <Appearance blocks={blocks} />}
          {tab === 'content' && <Content blocks={blocks} />}
          {tab === 'scenarios' && <Scenarios blocks={blocks} />}
        </div>
      )}
    </aside>
  );
}
