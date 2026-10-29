'use client';
import { type Block } from '@blokum/schema';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  type AlignMode,
  type OrderMode,
  alignBlocks,
  distributeBlocks,
  groupBlocks,
  orderBlocks,
  selectionIsGroup,
  ungroupBlocks,
} from '../../lib/editor/arrange';
import { flipBlocks, patchBlocks, setFrame } from '../../lib/editor/commands';
import { selectedBlocks } from '../../lib/editor/store';
import { PropsInspector } from './PropsInspector';
import { BehaviorsEditor } from './BehaviorsEditor';
import { ConditionEditor, newCondition } from './ConditionEditor';
import { Toggle } from './controls';
import { ScenarioEditor } from './ScenarioEditor';
import { ScreenPanel } from './ScreenPanel';
import { TextEditor } from './TextEditor';
import { AnimationInspector, StyleInspector } from './StylePanels';
import { useEditor, useEnv } from './context';

/** A field whose value is shown as «смешанно» when the selected blocks differ (E-15). */
export function mixed<T>(values: readonly T[]): T | null {
  return values.length > 0 && values.every((v) => v === values[0]) ? values[0]! : null;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  const shown = value === null ? '' : String(value);
  // The typed text is shown while it still means the stored number; otherwise the stored value, with no lag after a change elsewhere.
  const [draft, setDraft] = useState<string | null>(null);
  const text =
    draft !== null && (Number.isNaN(Number(draft)) || shown === '' || Number(draft) === Number(shown)) ? draft : shown;
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
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  max,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  max: number;
}) {
  return (
    <label className="ed-field">
      <span>{label}</span>
      <input
        type="text"
        value={value ?? ''}
        placeholder={value === null ? 'смешанно' : undefined}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const ALIGN: Array<[AlignMode, string, string]> = [
  ['left', 'По левому краю', '⇤'],
  ['center', 'По центру', '↔'],
  ['right', 'По правому краю', '⇥'],
  ['top', 'По верхнему краю', '⤒'],
  ['middle', 'По середине', '↕'],
  ['bottom', 'По нижнему краю', '⤓'],
];
const ORDER: Array<[OrderMode, string, string]> = [
  ['front', 'На передний план', '⤒'],
  ['forward', 'Вперёд', '↑'],
  ['backward', 'Назад', '↓'],
  ['back', 'На задний план', '⤓'],
];

/** E-09 · align, distribute, layer order, group — for the selected blocks. */
function Arrange({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const doc = useEditor((s) => s.doc);
  const ids = blocks.map((b) => b.id);
  const grouped = selectionIsGroup(doc, ids);
  return (
    <div className="ed-section" data-testid="arrange">
      <h2>Расположение</h2>
      <div className="ed-actions" role="group" aria-label="Выравнивание">
        {ALIGN.map(([mode, label, glyph]) => (
          <button
            key={mode}
            type="button"
            className="ed-btn small"
            aria-label={label}
            title={label}
            onClick={() => apply(alignBlocks(ids, mode), { label })}
          >
            {glyph}
          </button>
        ))}
        <button
          type="button"
          className="ed-btn small"
          aria-label="Распределить по горизонтали"
          title="Распределить по горизонтали"
          disabled={blocks.length < 3}
          onClick={() => apply(distributeBlocks(ids, 'horizontal'), { label: 'Распределить по горизонтали' })}
        >
          ⇹
        </button>
        <button
          type="button"
          className="ed-btn small"
          aria-label="Распределить по вертикали"
          title="Распределить по вертикали"
          disabled={blocks.length < 3}
          onClick={() => apply(distributeBlocks(ids, 'vertical'), { label: 'Распределить по вертикали' })}
        >
          ⇳
        </button>
      </div>
      <div className="ed-actions" role="group" aria-label="Порядок слоёв">
        {ORDER.map(([mode, label, glyph]) => (
          <button
            key={mode}
            type="button"
            className="ed-btn small"
            aria-label={label}
            title={label}
            onClick={() => apply(orderBlocks(ids, mode), { label })}
          >
            {glyph}
          </button>
        ))}
      </div>
      <div className="ed-actions" role="group" aria-label="Группа">
        <button
          type="button"
          className="ed-btn small"
          disabled={blocks.length < 2 || grouped}
          onClick={() => apply(groupBlocks(ids), { label: 'Сгруппировать' })}
        >
          Сгруппировать
        </button>
        <button
          type="button"
          className="ed-btn small"
          disabled={!blocks.some((b) => b.groupId)}
          onClick={() => apply(ungroupBlocks(ids), { label: 'Разгруппировать' })}
        >
          Разгруппировать
        </button>
      </div>
    </div>
  );
}

/** «Оформление»: place, size and turn of the selected blocks (the other style groups arrive with P3.4). */
function Appearance({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const ids = blocks.map((b) => b.id);
  const field = (key: 'x' | 'y' | 'w' | 'h', label: string) => (
    <NumberField
      label={label}
      value={mixed(blocks.map((b) => b.frame[key]))}
      onChange={(v) =>
        apply(setFrame(ids, { [key]: v }), { label: 'Положение и размер', mergeKey: `frame:${ids.join(',')}:${key}` })
      }
    />
  );
  return (
    <>
      <Arrange blocks={blocks} />
      <div className="ed-section">
        <h2>Положение и размер</h2>
        <div className="ed-grid">
          {field('x', 'X')}
          {field('y', 'Y')}
          {field('w', 'Ширина')}
          {field('h', 'Высота')}
          <NumberField
            label="Поворот"
            value={mixed(blocks.map((b) => b.frame.rotation))}
            min={-360}
            max={360}
            onChange={(v) =>
              apply(
                patchBlocks(
                  ids,
                  (b) => void (b.frame.rotation = Math.min(360, Math.max(-360, Math.round(v * 10) / 10))),
                ),
                { label: 'Поворот', mergeKey: `rotation:${ids.join(',')}` },
              )
            }
          />
        </div>
        <div className="ed-actions">
          <button
            type="button"
            className="ed-btn small"
            aria-pressed={blocks.every((b) => b.frame.flipX)}
            onClick={() => apply(flipBlocks(ids, 'x'), { label: 'Отразить по горизонтали' })}
          >
            Отразить по горизонтали
          </button>
          <button
            type="button"
            className="ed-btn small"
            aria-pressed={blocks.every((b) => b.frame.flipY)}
            onClick={() => apply(flipBlocks(ids, 'y'), { label: 'Отразить по вертикали' })}
          >
            Отразить по вертикали
          </button>
        </div>
      </div>
      <VisibilitySection blocks={blocks} />
      <StyleInspector blocks={blocks} />
      <AnimationInspector blocks={blocks} />
    </>
  );
}

/** S-16 · when the block is on the screen: from the start or only after a rule shows it, and only while a condition holds. */
function VisibilitySection({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const ids = blocks.map((b) => b.id);
  const single = blocks.length === 1 ? blocks[0]! : null;
  const hidden = blocks.every((b) => b.initiallyHidden) ? true : blocks.every((b) => !b.initiallyHidden) ? false : null;
  return (
    <div className="ed-section" data-testid="visibility-section">
      <h2>Видимость</h2>
      <Toggle control="visibility:initially-hidden" label="Скрыт, пока правило его не покажет" value={hidden} onChange={(v) => apply(patchBlocks(ids, (b) => void (b.initiallyHidden = v)), { label: 'Скрыт в начале' })} />
      {single && (
        <>
          <Toggle
            control="visibility:condition"
            label="Показывать по условию"
            value={single.visibleIf !== undefined}
            onChange={(on) => apply(patchBlocks(ids, (b) => (on ? void (b.visibleIf = newCondition('variable', { variableIds: [], questionIds: [], blockIds: [] })) : void (b.visibleIf = undefined))), { label: 'Условие показа' })}
          />
          {single.visibleIf && (
            <ConditionEditor
              label="Показывать, если"
              value={single.visibleIf}
              onChange={(c) => apply(patchBlocks(ids, (b) => void (b.visibleIf = c)), { label: 'Условие показа', mergeKey: `visible-if:${single.id}` })}
            />
          )}
        </>
      )}
    </div>
  );
}

/** «Содержимое»: what the block is called and how it is announced to a screen reader. */
function Content({ blocks }: { blocks: Block[] }) {
  const apply = useEditor((s) => s.apply);
  const ids = blocks.map((b) => b.id);
  const single = blocks.length === 1 ? blocks[0]! : null;
  return (
    <>
      <div className="ed-section">
        <h2>Содержимое</h2>
        {single && (
          <TextField
            label="Название блока"
            value={single.name}
            max={60}
            onChange={(v) =>
              v.trim() &&
              apply(
                patchBlocks(ids, (b) => void (b.name = v.slice(0, 60))),
                { label: 'Название блока', mergeKey: `name:${single.id}` },
              )
            }
          />
        )}
        {single && (single.type === 'text' || single.textLayer) ? (
          <>
            <TextEditor key={single.id} block={single} />
            {single.type !== 'text' && (
              <button type="button" className="ed-btn small" onClick={() => apply(patchBlocks(ids, (b) => void (b.textLayer = undefined)), { label: 'Убрать текст' })}>
                Убрать текст
              </button>
            )}
          </>
        ) : single ? (
          <button type="button" className="ed-btn small" onClick={() => apply(patchBlocks(ids, (b) => void (b.textLayer = { paragraphs: [{ kind: 'p', runs: [] }] })), { label: 'Добавить текст' })}>
            Добавить текст
          </button>
        ) : (
          <p className="ed-hint">Чтобы изменить текст, выберите один блок.</p>
        )}
        <TextField
          label="Описание для скринридера"
          value={mixed(blocks.map((b) => b.a11y.alt ?? ''))}
          max={300}
          onChange={(v) =>
            apply(
              patchBlocks(ids, (b) => void (b.a11y.alt = v || undefined)),
              { label: 'Описание для скринридера', mergeKey: `alt:${ids.join(',')}` },
            )
          }
        />
      </div>
      <PropsInspector blocks={blocks} />
    </>
  );
}

/** «Сценарии»: the rules of the selected block as a constructor (P3.8); with several blocks selected only the counts. */
function Scenarios({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 1) {
    const block = blocks[0]!;
    return (
      <>
        <BehaviorsEditor blockId={block.id} behaviors={block.behaviors} />
        <ScenarioEditor owner={{ kind: 'block', blockId: block.id }} rules={block.rules} title="Правила" />
        <p className="ed-hint" data-testid="scenario-counts" style={{ padding: '0 12px' }}>
          Правил: {block.rules.length}. Поведений: {block.behaviors.length}.
        </p>
      </>
    );
  }
  const rules = blocks.reduce((n, b) => n + b.rules.length, 0);
  const behaviors = blocks.reduce((n, b) => n + b.behaviors.length, 0);
  return (
    <div className="ed-section">
      <h2>Сценарии</h2>
      <p className="ed-hint" data-testid="scenario-counts">
        Правил: {rules}. Поведений: {behaviors}. Выберите один блок, чтобы править его сценарии.
      </p>
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
  const { focus } = useEnv();
  const asked = useSyncExternalStore(focus.subscribe, focus.getSnapshot, focus.getSnapshot);
  // SC-07: «Показать» in the check takes the inspector to the tab where the thing is.
  useEffect(() => {
    if (asked.tab) setTab(asked.tab);
  }, [asked]);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const blocks = selectedBlocks({ doc, selection });
  return (
    <aside className="ed-panel right" aria-label="Свойства">
      <div className="ed-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="ed-tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {blocks.length === 0 ? (
        tab === 'look' ? (
          <ScreenPanel />
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
