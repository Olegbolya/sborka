'use client';
import { BlockStyle, type Color, type MediaRef, TRANSITION_KINDS, type Action, textOf, plainText } from '@blokum/schema';
import { useRef, useState, useSyncExternalStore } from 'react';
import { type ListPath, addAction, moveAction, removeAction, setAction, type RuleOwner } from '../../lib/editor/rules';
import { describeAction, namesOf } from '../../lib/editor/rule-text';
import { ACTIONS, PROPERTY_TITLES, type MakeContext, type PartSpec, type SField, allBlocks } from '../../lib/editor/scenario-specs';
import { ConditionEditor, newCondition } from './ConditionEditor';
import { ColorInput, NumberInput, SelectInput, TextInput, Toggle } from './controls';
import { useEditor, useEnv } from './context';
import { useInDialog } from './Dialog';
import { MediaPicker } from './MediaPicker';
import { ScreenField, TransitionPresetField, VariableField } from './PropsFields';

type Value = Record<string, unknown>;
const NONE = '';

/** Where in the document the form edits: what a nested list of actions needs to find its place. */
export interface Place {
  owner: RuleOwner;
  ruleId: string;
  /** The list the edited action is in, and its index. */
  path: ListPath;
  index: number;
}

/** A text value out of unknown data (never «[object Object]»). */
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asRecord = (v: unknown): Value => (v && typeof v === 'object' ? (v as Value) : {});

// ── A block: from the list, or by a tap on the canvas ────────────────────────
export function BlockPick({ label, value, onChange, types, optional }: { label: string; value: string | null; onChange: (id: string) => void; types?: readonly string[]; optional?: boolean }) {
  const doc = useEditor((s) => s.doc);
  const { picker } = useEnv();
  const inDialog = useInDialog();
  const state = useSyncExternalStore(picker.subscribe, picker.getSnapshot, picker.getSnapshot);
  const blocks = allBlocks(doc).filter(({ block }) => !types || types.includes(block.type) || block.id === value);
  const known = value !== null && blocks.some(({ block }) => block.id === value);
  const many = doc.screens.length > 1;
  return (
    <div className="ed-field ed-pick">
      <SelectInput<string>
        control={`pick:${label}`}
        label={label}
        value={known ? value : NONE}
        options={[[NONE, value && !known ? 'Блок удалён — выберите другой' : optional ? 'Не выбран' : 'Выберите блок'], ...blocks.map(({ block, screenName }) => [block.id, many ? `${screenName} · ${block.name}` : block.name] as const)]}
        onChange={(id) => id !== NONE && onChange(id)}
      />
      {!inDialog && (
      <button type="button" className="ed-btn small" aria-label={`${label}: указать на холсте`} aria-pressed={state.active} onClick={() => (state.active ? picker.cancel() : picker.request(`Нажмите на блок на холсте — «${label}»`, onChange))}>
        {state.active ? 'Отмена' : 'Указать на холсте'}
      </button>
      )}
    </div>
  );
}

function BlockList({ label, value, onChange, max }: { label: string; value: string[]; onChange: (ids: string[]) => void; max: number }) {
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      {value.map((id, i) => (
        <div key={i} className="ed-row">
          <BlockPick label={`${label}, ${i + 1}`} value={id} onChange={(next) => onChange(value.map((x, j) => (j === i ? next : x)))} />
          <button type="button" className="ed-btn small" aria-label={`${label}: убрать ${i + 1}`} disabled={value.length <= 1} onClick={() => onChange(value.filter((_x, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="ed-btn small" disabled={value.length >= max} onClick={() => onChange([...value, value[value.length - 1] ?? ''])}>
        Добавить блок
      </button>
    </div>
  );
}

// ── A source and a target ─────────────────────────────────────────────────────
function GroupPick({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const doc = useEditor((s) => s.doc);
  const groups = [...new Set(allBlocks(doc).map(({ block }) => block.groupId).filter((g): g is string => !!g))];
  return (
    <SelectInput<string>
      control={`pick:${label}`}
      label={label}
      value={groups.includes(value) ? value : NONE}
      options={[[NONE, groups.length === 0 ? 'Групп пока нет' : 'Выберите группу'], ...groups.map((g, i) => [g, `Группа ${i + 1}`] as const)]}
      onChange={(g) => g !== NONE && onChange(g)}
    />
  );
}

function SourceForm({ label, value, onChange, allowSelf }: { label: string; value: Value; onChange: (v: Value) => void; allowSelf?: boolean }) {
  const kind = str(value.kind, 'block');
  const options: Array<readonly [string, string]> = [
    ['block', 'Блок'],
    ['copiesOf', 'Любая копия блока'],
    ['group', 'Группа блоков'],
    ...(allowSelf ? ([['self', 'Блок, у которого сработало правило']] as const) : []),
  ];
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      <SelectInput<string>
        control={`kind:${label}`}
        label={`${label}: что именно`}
        value={kind}
        options={options}
        onChange={(k) => onChange(k === 'self' ? { kind: 'self' } : k === 'group' ? { kind: 'group', groupId: '' } : { kind: k, blockId: str(value.blockId, '') })}
      />
      {kind === 'group' ? (
        <GroupPick label={`${label}: группа`} value={str(value.groupId, '')} onChange={(groupId) => onChange({ kind: 'group', groupId })} />
      ) : kind !== 'self' ? (
        <BlockPick label={`${label}: блок`} value={str(value.blockId, '') || null} onChange={(blockId) => onChange({ kind, blockId })} />
      ) : null}
    </div>
  );
}

// ── Values ────────────────────────────────────────────────────────────────────
function ScalarField({ label, value, onChange, optional }: { label: string; value: unknown; onChange: (v: unknown) => void; optional?: boolean }) {
  const kind = value === undefined ? 'none' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'text';
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      <SelectInput<string>
        control={`kind:${label}`}
        label={`${label}: вид`}
        value={kind}
        options={[...(optional ? ([['none', 'Не задано']] as const) : []), ['number', 'Число'], ['text', 'Текст'], ['bool', 'Да или нет']]}
        onChange={(k) => onChange(k === 'none' ? undefined : k === 'number' ? 0 : k === 'bool' ? true : '')}
      />
      {kind === 'number' && <NumberInput control={`value:${label}`} label={`${label}: число`} value={value as number} step={1} onChange={onChange} />}
      {kind === 'text' && <TextInput control={`value:${label}`} label={`${label}: текст`} value={value as string} max={1000} onChange={onChange} />}
      {kind === 'bool' && <Toggle control={`value:${label}`} label={`${label}: да`} value={value as boolean} onChange={onChange} />}
    </div>
  );
}

function RectField({ label, value, onChange, optional }: { label: string; value: unknown; onChange: (v: unknown) => void; optional?: boolean }) {
  const rect = value && typeof value === 'object' ? (value as { x: number; y: number; w: number; h: number }) : null;
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      {optional && <Toggle control={`on:${label}`} label={`${label}: задать`} value={rect !== null} onChange={(on) => onChange(on ? { x: 0, y: 0, w: 390, h: 400 } : undefined)} />}
      {rect &&
        (['x', 'y', 'w', 'h'] as const).map((k) => (
          <NumberInput key={k} control={`rect:${label}:${k}`} label={`${label}: ${{ x: 'слева', y: 'сверху', w: 'ширина', h: 'высота' }[k]}`} value={rect[k]} min={k === 'w' || k === 'h' ? 0 : -10000} max={10000} step={1} onChange={(n) => onChange({ ...rect, [k]: n })} />
        ))}
    </div>
  );
}

const EASINGS: ReadonlyArray<readonly [string, string]> = [['', 'Обычное'], ['linear', 'Ровно'], ['ease', 'Плавно'], ['easeIn', 'Медленный старт'], ['easeOut', 'Медленный финиш'], ['easeInOut', 'Медленно в начале и в конце'], ['spring', 'Пружина'], ['bezier', 'Своя кривая']];
function EasingField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const e = value && typeof value === 'object' ? (value as Value) : null;
  const shown = e === null ? '' : e.kind === 'preset' ? String(e.name) : String(e.kind);
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <SelectInput<string>
        control={`easing:${label}`}
        label={label}
        value={shown}
        options={EASINGS}
        onChange={(v) => onChange(v === '' ? undefined : v === 'spring' ? { kind: 'spring', stiffness: 170, damping: 26 } : v === 'bezier' ? { kind: 'bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } : { kind: 'preset', name: v })}
      />
      {e?.kind === 'spring' && (
        <>
          <NumberInput control={`easing:${label}:s`} label={`${label}: жёсткость`} value={Number(e.stiffness)} min={10} max={1000} onChange={(n) => onChange({ ...e, stiffness: n })} />
          <NumberInput control={`easing:${label}:d`} label={`${label}: затухание`} value={Number(e.damping)} min={1} max={100} onChange={(n) => onChange({ ...e, damping: n })} />
        </>
      )}
      {e?.kind === 'bezier' &&
        (['x1', 'y1', 'x2', 'y2'] as const).map((k) => <NumberInput key={k} control={`easing:${label}:${k}`} label={`${label}: ${k}`} value={Number(e[k])} min={k.startsWith('x') ? 0 : -2} max={k.startsWith('x') ? 1 : 3} step={0.05} onChange={(n) => onChange({ ...e, [k]: n })} />)}
    </div>
  );
}

function DestinationField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const d = asRecord(value);
  const kind = str(d.kind, 'by');
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      <SelectInput<string>
        control={`dest:${label}`}
        label={`${label}: как задать`}
        value={kind}
        options={[['by', 'Сдвинуть на'], ['point', 'В точку'], ['block', 'К блоку'], ['randomIn', 'В случайное место области']]}
        onChange={(k) => onChange(k === 'by' ? { kind: 'by', dx: 0, dy: 0 } : k === 'point' ? { kind: 'point', point: { x: 195, y: 300 } } : k === 'block' ? { kind: 'block', blockId: '' } : { kind: 'randomIn', area: { x: 0, y: 0, w: 390, h: 400 } })}
      />
      {kind === 'by' && (
        <>
          <NumberInput control={`dest:${label}:dx`} label={`${label}: вправо`} value={Number(d.dx ?? 0)} min={-10000} max={10000} onChange={(n) => onChange({ ...d, dx: n })} />
          <NumberInput control={`dest:${label}:dy`} label={`${label}: вниз`} value={Number(d.dy ?? 0)} min={-10000} max={10000} onChange={(n) => onChange({ ...d, dy: n })} />
        </>
      )}
      {kind === 'point' && (
        <>
          <NumberInput control={`dest:${label}:x`} label={`${label}: слева`} value={Number(asRecord(d.point).x ?? 0)} min={-10000} max={10000} onChange={(n) => onChange({ kind: 'point', point: { ...asRecord(d.point), x: n } })} />
          <NumberInput control={`dest:${label}:y`} label={`${label}: сверху`} value={Number(asRecord(d.point).y ?? 0)} min={-10000} max={10000} onChange={(n) => onChange({ kind: 'point', point: { ...asRecord(d.point), y: n } })} />
        </>
      )}
      {kind === 'block' && <BlockPick label={`${label}: блок`} value={str(d.blockId, '') || null} onChange={(blockId) => onChange({ kind: 'block', blockId })} />}
      {kind === 'randomIn' && <RectField label={`${label}: область`} value={d.area} onChange={(area) => onChange({ kind: 'randomIn', area })} />}
    </div>
  );
}

function MediaField({ label, value, onChange, kinds, optional }: { label: string; value: unknown; onChange: (v: MediaRef | undefined) => void; kinds: ReadonlyArray<'IMAGE' | 'GIF' | 'VIDEO' | 'AUDIO' | 'LOTTIE'>; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = value && typeof value === 'object' ? (value as MediaRef) : null;
  const unset = ref === null || ref.id === 'media_unset';
  return (
    <div className="ed-field">
      <span>{label}</span>
      <div className="ed-row">
        <button type="button" className="ed-btn small" aria-label={`${label}: выбрать файл`} onClick={() => setOpen(true)}>
          {unset ? 'Выбрать файл' : 'Заменить файл'}
        </button>
        {optional && !unset && (
          <button type="button" className="ed-btn small" aria-label={`${label}: убрать`} onClick={() => onChange(undefined)}>
            Убрать
          </button>
        )}
        <span className="ed-hint">{unset ? 'Файл не выбран' : 'Файл выбран'}</span>
      </div>
      {open && (
        <MediaPicker
          kinds={kinds}
          onPick={(r) => {
            onChange(r);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

const POSITIONS: ReadonlyArray<readonly [string, string]> = [['bottom', 'внизу'], ['top', 'вверху']];
function OverlayField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const tokens = useEditor((s) => s.doc.theme.tokens);
  const o = asRecord(value);
  const caption = o.caption && typeof o.caption === 'object' ? (o.caption as Value) : null;
  const set = (patch: Value) => onChange({ ...o, ...patch });
  const setCaption = (patch: Value) => set({ caption: { ...caption, ...patch } });
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      <MediaField label={`${label}: картинка или видео`} value={o.media} kinds={['IMAGE', 'GIF', 'VIDEO']} onChange={(media) => media && set({ media })} />
      <NumberInput control={`overlay:${label}:s`} label={`${label}: сколько секунд`} value={Number(o.seconds ?? 1.5)} min={0.3} max={10} step={0.1} onChange={(seconds) => set({ seconds })} />
      <Toggle control={`overlay:${label}:skip`} label={`${label}: можно пропустить`} value={o.skippable !== false} onChange={(skippable) => set({ skippable })} />
      <MediaField label={`${label}: звук`} value={o.sound} kinds={['AUDIO']} optional onChange={(sound) => set({ sound })} />
      <Toggle control={`overlay:${label}:cap`} label={`${label}: подпись`} value={caption !== null} onChange={(on) => set({ caption: on ? { text: 'Подпись', position: 'bottom', font: { kind: 'system', name: 'sans' }, size: 36, color: { hex: '#FFFFFF' }, outline: 3 } : undefined })} />
      {caption && (
        <>
          <TextInput control={`overlay:${label}:text`} label={`${label}: текст подписи`} value={str(caption.text, '')} max={200} onChange={(text) => setCaption({ text })} />
          <SelectInput<string> control={`overlay:${label}:pos`} label={`${label}: где подпись`} value={str(caption.position, 'bottom')} options={POSITIONS} onChange={(position) => setCaption({ position })} />
          <NumberInput control={`overlay:${label}:size`} label={`${label}: размер букв`} value={Number(caption.size ?? 36)} min={10} max={120} onChange={(size) => setCaption({ size })} />
          <NumberInput control={`overlay:${label}:outline`} label={`${label}: обводка букв`} value={Number(caption.outline ?? 3)} min={0} max={12} onChange={(outline) => setCaption({ outline })} />
          <ColorInput control={`overlay:${label}:color`} label={`${label}: цвет букв`} value={(caption.color ?? { hex: '#FFFFFF' }) as Color} tokens={tokens} onChange={(color) => setCaption({ color })} />
        </>
      )}
    </div>
  );
}

const TRANSITION_TITLES: Record<string, string> = { none: 'Мгновенно', fade: 'Растворение', slide: 'Сдвиг', zoom: 'Увеличение', flip: 'Переворот', blinds: 'Жалюзи', particles: 'Частицы', page: 'Страница' };
const DIRECTIONS: ReadonlyArray<readonly [string, string]> = [['up', 'вверх'], ['down', 'вниз'], ['left', 'влево'], ['right', 'вправо'], ['upLeft', 'вверх и влево'], ['upRight', 'вверх и вправо'], ['downLeft', 'вниз и влево'], ['downRight', 'вниз и вправо']];
function TransitionField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const t = value && typeof value === 'object' ? (value as Value) : null;
  const kind = t === null ? '' : String(t.kind);
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      <SelectInput<string>
        control={`transition:${label}`}
        label={`${label}: вид`}
        value={kind}
        options={[['', 'Как в теме'], ...TRANSITION_KINDS.map((k) => [k, TRANSITION_TITLES[k] ?? k] as const), ['media', 'Вставка с мемом'], ['preset', 'Свой переход из темы']]}
        onChange={(k) => onChange(k === '' ? undefined : k === 'media' ? { kind: 'media', overlay: { media: { source: 'media', id: 'media_unset' } } } : k === 'preset' ? { kind: 'preset', presetId: '' } : { kind: k, direction: 'left', durationMs: 400, delayMs: 0, easing: { kind: 'preset', name: 'easeOut' }, blur: 0, scale: 1 })}
      />
      {kind !== '' && kind !== 'media' && kind !== 'preset' && (
        <>
          <SelectInput<string> control={`transition:${label}:dir`} label={`${label}: направление`} value={str(t!.direction, 'left')} options={DIRECTIONS} onChange={(direction) => onChange({ ...t, direction })} />
          <NumberInput control={`transition:${label}:ms`} label={`${label}: сколько длится`} value={Number(t!.durationMs ?? 400)} min={50} max={3000} step={50} suffix="мс" onChange={(durationMs) => onChange({ ...t, durationMs })} />
          <NumberInput control={`transition:${label}:delay`} label={`${label}: задержка`} value={Number(t!.delayMs ?? 0)} min={0} max={3000} step={50} suffix="мс" onChange={(delayMs) => onChange({ ...t, delayMs })} />
          <EasingField label={`${label}: ускорение`} value={t!.easing} onChange={(easing) => onChange({ ...t, easing: easing ?? { kind: 'preset', name: 'easeOut' } })} />
          <NumberInput control={`transition:${label}:blur`} label={`${label}: размытие`} value={Number(t!.blur ?? 0)} min={0} max={40} onChange={(blur) => onChange({ ...t, blur })} />
          <NumberInput control={`transition:${label}:scale`} label={`${label}: масштаб`} value={Number(t!.scale ?? 1)} min={0.2} max={3} step={0.1} onChange={(scale) => onChange({ ...t, scale })} />
        </>
      )}
      {kind === 'media' && <OverlayField label={`${label}: вставка`} value={t!.overlay} onChange={(overlay) => onChange({ kind: 'media', overlay })} />}
      {kind === 'preset' && <TransitionPresetField control={`transition:${label}:preset`} label={`${label}: переход из темы`} value={str(t!.presetId, '') || null} onChange={(presetId) => onChange({ kind: 'preset', presetId })} />}
    </div>
  );
}

/** AC-02 · the new value depends on the property: a number, a switch, a text, a colour, a file — or, for a group of the style, the value of another block. */
const NUMERIC = new Set(['frame.x', 'frame.y', 'frame.w', 'frame.h', 'frame.rotation']);
function PropertyValueField({ label, property, value, onChange }: { label: string; property: string; value: unknown; onChange: (p: string, v: unknown) => void }) {
  const doc = useEditor((s) => s.doc);
  const tokens = doc.theme.tokens;
  const [source, setSource] = useState('');
  const initial = (p: string): unknown => (NUMERIC.has(p) ? 0 : p === 'frame.flipX' || p === 'frame.flipY' ? true : p === 'textLayer' ? textOf('') : p === 'props.media' ? { source: 'media', id: 'media_unset' } : p === 'style.fills' ? [{ kind: 'solid', color: { token: 'primary', alpha: 1 } }] : (BlockStyle.parse({}) as unknown as Value)[p.slice(6)]);
  return (
    <div className="ed-layer" role="group" aria-label={label}>
      <strong>{label}</strong>
      <SelectInput<string> control={`prop:${label}`} label={`${label}: что менять`} value={property} options={Object.entries(PROPERTY_TITLES)} onChange={(p) => onChange(p, initial(p))} />
      {NUMERIC.has(property) && <NumberInput control={`prop:${label}:v`} label={`${label}: новое значение`} value={Number(value ?? 0)} min={-10000} max={10000} onChange={(n) => onChange(property, n)} />}
      {(property === 'frame.flipX' || property === 'frame.flipY') && <Toggle control={`prop:${label}:v`} label={`${label}: отражено`} value={value === true} onChange={(v) => onChange(property, v)} />}
      {property === 'textLayer' && <TextInput control={`prop:${label}:v`} label={`${label}: новый текст`} value={value && typeof value === 'object' ? plainText(value as Parameters<typeof plainText>[0]) : ''} max={2000} onChange={(t) => onChange(property, textOf(t))} />}
      {property === 'props.media' && <MediaField label={`${label}: файл`} value={value} kinds={['IMAGE', 'GIF', 'VIDEO']} onChange={(m) => m && onChange(property, m)} />}
      {property === 'style.fills' && (
        <ColorInput
          control={`prop:${label}:v`}
          label={`${label}: цвет заливки`}
          value={((value as Array<{ color?: Color }> | undefined)?.[0]?.color ?? { token: 'primary', alpha: 1 })}
          tokens={tokens}
          onChange={(color) => onChange(property, [{ kind: 'solid', color }])}
        />
      )}
      {property.startsWith('style.') && property !== 'style.fills' && (
        <div className="ed-field">
          <BlockPick label={`${label}: взять оформление у блока`} value={source || null} onChange={(id) => setSource(id)} />
          <button
            type="button"
            className="ed-btn small"
            disabled={!source}
            onClick={() => {
              const block = allBlocks(doc).find((b) => b.block.id === source)?.block;
              const group = property.slice(6);
              onChange(property, JSON.parse(JSON.stringify((block?.style as Value | undefined)?.[group] ?? (BlockStyle.parse({}) as unknown as Value)[group])));
            }}
          >
            Взять значение
          </button>
          <span className="ed-hint">Значение группы «{PROPERTY_TITLES[property as keyof typeof PROPERTY_TITLES]}» задано.</span>
        </div>
      )}
    </div>
  );
}

function OptionPick({ label, value, questionId, onChange, optional }: { label: string; value: string | undefined; questionId: string; onChange: (id: string | undefined) => void; optional?: boolean }) {
  const doc = useEditor((s) => s.doc);
  const block = allBlocks(doc).find((b) => b.block.id === questionId)?.block;
  const options = (block && 'options' in block.props ? (block.props.options as Array<{ id: string; blockId: string }>) : []).map((o, i) => [o.id, `${i + 1}. ${block!.children.find((c) => c.id === o.blockId)?.name ?? 'вариант'}`] as const);
  return (
    <SelectInput<string>
      control={`option:${label}`}
      label={label}
      value={value && options.some(([id]) => id === value) ? value : NONE}
      options={[[NONE, options.length === 0 ? 'У вопроса нет вариантов' : optional ? 'Не выбран' : 'Выберите вариант'], ...options]}
      onChange={(id) => onChange(id === NONE ? undefined : id)}
    />
  );
}

// ── The fields of a part ──────────────────────────────────────────────────────
function Field({ field, value, onChange, place, ctx }: { field: SField; value: Value; onChange: (v: Value) => void; place: Place | null; ctx: MakeContext }) {
  const set = (key: string, v: unknown) => {
    const next = { ...value };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const optionalToggle = (key: string, label: string, make: () => unknown, present: boolean, child: React.ReactNode) => (
    <div className="ed-layer" role="group" aria-label={label}>
      <Toggle control={`on:${label}`} label={`${label}: задать`} value={present} onChange={(on) => set(key, on ? make() : undefined)} />
      {present && child}
    </div>
  );
  switch (field.t) {
    case 'source':
      return <SourceForm label={field.label} value={asRecord(value[field.key])} onChange={(v) => set(field.key, v)} />;
    case 'screenOrSource': {
      const v = value[field.key];
      return (
        <div className="ed-layer" role="group" aria-label={field.label}>
          <SelectInput<string> control={`kind:${field.label}`} label={field.label} value={v === 'screen' ? 'screen' : 'source'} options={[['screen', 'Везде на экране'], ['source', 'По блоку']]} onChange={(k) => set(field.key, k === 'screen' ? 'screen' : { kind: 'block', blockId: ctx.self })} />
          {v !== 'screen' && <SourceForm label={`${field.label}: блок`} value={asRecord(v)} onChange={(x) => set(field.key, x)} />}
        </div>
      );
    }
    case 'target': {
      const body = <SourceForm label={field.label} value={asRecord(value[field.key])} onChange={(v) => set(field.key, v)} allowSelf />;
      return field.optional ? optionalToggle(field.key, field.label, () => ({ kind: 'self' }), value[field.key] !== undefined, body) : body;
    }
    case 'targets': {
      const list = (Array.isArray(value[field.key]) ? value[field.key] : []) as Value[];
      return (
        <div className="ed-layer" role="group" aria-label={field.label}>
          <strong>{field.label}</strong>
          {list.map((t, i) => (
            <div key={i} className="ed-row">
              <SourceForm label={`${field.label}, ${i + 1}`} value={t} onChange={(v) => set(field.key, list.map((x, j) => (j === i ? v : x)))} allowSelf />
              <button type="button" className="ed-btn small" aria-label={`${field.label}: убрать ${i + 1}`} disabled={list.length <= 1} onClick={() => set(field.key, list.filter((_x, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="ed-btn small" disabled={list.length >= 50} onClick={() => set(field.key, [...list, { kind: 'self' }])}>
            Добавить блок
          </button>
        </div>
      );
    }
    case 'block': {
      const body = <BlockPick label={field.label} value={str(value[field.key], '') || null} onChange={(id) => set(field.key, id)} {...(field.types ? { types: field.types } : {})} {...(field.optional ? { optional: true } : {})} />;
      return field.optional ? optionalToggle(field.key, field.label, () => ctx.self, value[field.key] !== undefined, body) : body;
    }
    case 'blocks':
      return <BlockList label={field.label} value={(Array.isArray(value[field.key]) ? value[field.key] : []) as string[]} max={100} onChange={(ids) => set(field.key, ids)} />;
    case 'variable':
      return <VariableField control={`var:${field.label}`} label={field.label} value={str(value[field.key], '') || null} optional={false} onChange={(id) => set(field.key, id)} />;
    case 'screen':
      return value.to === undefined || value.to === 'screen' ? <ScreenField control={`screen:${field.label}`} label={field.label} value={str(value[field.key], '') || null} onChange={(id) => set(field.key, id)} /> : null;
    case 'num': {
      const body = <NumberInput control={`num:${field.label}`} label={field.label} value={Number(value[field.key] ?? field.min)} min={field.min} max={field.max} {...(field.step ? { step: field.step } : {})} {...(field.suffix ? { suffix: field.suffix } : {})} onChange={(n) => set(field.key, n)} />;
      return field.optional ? optionalToggle(field.key, field.label, () => Math.max(field.min, Math.min(field.max, 3)), value[field.key] !== undefined, body) : body;
    }
    case 'number': {
      const body = <NumberInput control={`num:${field.label}`} label={field.label} value={Number(value[field.key] ?? 0)} min={-10000} max={10000} onChange={(n) => set(field.key, n)} />;
      return field.optional ? optionalToggle(field.key, field.label, () => 0, value[field.key] !== undefined, body) : body;
    }
    case 'text': {
      const body = <TextInput control={`text:${field.label}`} label={field.label} value={str(value[field.key], '')} max={field.max} onChange={(t) => set(field.key, t)} />;
      return field.optional ? optionalToggle(field.key, field.label, () => '', value[field.key] !== undefined, body) : body;
    }
    case 'pathText': {
      const body = <TextInput control={`text:${field.label}`} label={field.label} value={str(value[field.key], '')} max={4000} onChange={(t) => set(field.key, t || undefined)} />;
      return field.optional ? optionalToggle(field.key, field.label, () => 'M0 0 L100 0', value[field.key] !== undefined, body) : body;
    }
    case 'select':
      return (
        <SelectInput<string>
          control={`select:${field.label}`}
          label={field.label}
          value={value[field.key] === undefined ? NONE : String(value[field.key])}
          options={field.optional ? [[NONE, 'Не задано'], ...field.options] : field.options}
          onChange={(v) => set(field.key, v === NONE ? undefined : v)}
        />
      );
    case 'bool':
      return <Toggle control={`bool:${field.label}`} label={field.label} value={value[field.key] === true} onChange={(v) => set(field.key, v)} />;
    case 'scalar':
      return <ScalarField label={field.label} value={value[field.key]} {...(field.optional ? { optional: true } : {})} onChange={(v) => set(field.key, v)} />;
    case 'easing':
      return <EasingField label={field.label} value={value[field.key]} onChange={(v) => set(field.key, v)} />;
    case 'destination':
      return <DestinationField label={field.label} value={value[field.key]} onChange={(v) => set(field.key, v)} />;
    case 'rect':
      return <RectField label={field.label} value={value[field.key]} {...(field.optional ? { optional: true } : {})} onChange={(v) => set(field.key, v)} />;
    case 'transition':
      return <TransitionField label={field.label} value={value[field.key]} onChange={(v) => set(field.key, v)} />;
    case 'overlay':
      return <OverlayField label={field.label} value={value[field.key]} onChange={(v) => set(field.key, v)} />;
    case 'media':
      return <MediaField label={field.label} value={value[field.key]} kinds={field.kinds ?? ['IMAGE']} onChange={(m) => m && set(field.key, m)} />;
    case 'condition': {
      if (field.key === 'items') return null;
      const present = value[field.key] !== undefined;
      const body = present ? (
        <ConditionEditor label={field.label} value={value[field.key] as never} onChange={(c) => set(field.key, c)} />
      ) : null;
      return field.optional ? optionalToggle(field.key, field.label, () => newCondition('variable', { variableIds: [], questionIds: [], blockIds: [] }), present, body) : body;
    }
    case 'actions':
      return place ? <ActionList label={field.label} owner={place.owner} ruleId={place.ruleId} path={[...place.path, place.index, field.key as 'then' | 'else' | 'do']} actions={(Array.isArray(value[field.key]) ? value[field.key] : []) as Action[]} /> : null;
    case 'propertyValue':
      return <PropertyValueField label={field.label} property={str(value.property, 'frame.x')} value={value.value} onChange={(p, v) => onChange({ ...value, property: p, value: v })} />;
    case 'recordValue': {
      const v = asRecord(value.value);
      const isVar = 'variableId' in v;
      return (
        <div className="ed-layer" role="group" aria-label={field.label}>
          <SelectInput<string> control={`record:${field.label}`} label={field.label} value={isVar ? 'variable' : 'text'} options={[['variable', 'Значение переменной'], ['text', 'Свой текст']]} onChange={(k) => set('value', k === 'variable' ? { variableId: ctx.doc.variables[0]?.id ?? 'variable_unset' } : { text: '' })} />
          {isVar ? <VariableField control={`record:${field.label}:v`} label={`${field.label}: переменная`} value={str(v.variableId, '') || null} optional={false} onChange={(id) => set('value', { variableId: id })} /> : <TextInput control={`record:${field.label}:t`} label={`${field.label}: текст`} value={str(v.text, '')} max={500} onChange={(text) => set('value', { text })} />}
        </div>
      );
    }
    case 'sectors': {
      const list = (Array.isArray(value.sectors) ? value.sectors : []) as Array<{ blockId: string; weight: number }>;
      return (
        <div className="ed-layer" role="group" aria-label={field.label}>
          <strong>{field.label}</strong>
          {list.map((sec, i) => (
            <div key={i} className="ed-row">
              <BlockPick label={`Сектор ${i + 1}`} value={sec.blockId || null} onChange={(blockId) => set('sectors', list.map((x, j) => (j === i ? { ...x, blockId } : x)))} />
              <NumberInput control={`sector:${i}:w`} label={`Сектор ${i + 1}: шанс`} value={sec.weight} min={0} max={1000} step={0.5} onChange={(weight) => set('sectors', list.map((x, j) => (j === i ? { ...x, weight } : x)))} />
              <button type="button" className="ed-btn small" aria-label={`Сектор ${i + 1}: убрать`} disabled={list.length <= 2} onClick={() => set('sectors', list.filter((_x, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="ed-btn small" disabled={list.length >= 24} onClick={() => set('sectors', [...list, { blockId: ctx.self, weight: 1 }])}>
            Добавить сектор
          </button>
        </div>
      );
    }
    case 'optionOf':
      return <OptionPick label={field.label} value={value[field.key] as string | undefined} questionId={str(value[field.questionKey], '')} {...(field.optional ? { optional: true } : {})} onChange={(id) => set(field.key, id)} />;
    case 'zones': {
      const list = (Array.isArray(value[field.key]) ? value[field.key] : []) as string[];
      return (
        <div className="ed-layer" role="group" aria-label={field.label}>
          <strong>{field.label}</strong>
          {list.map((id, i) => (
            <div key={i} className="ed-row">
              <BlockPick label={`${field.label}, ${i + 1}`} value={id || null} types={['zone']} onChange={(z) => set(field.key, list.map((x, j) => (j === i ? z : x)))} />
              <button type="button" className="ed-btn small" aria-label={`${field.label}: убрать ${i + 1}`} onClick={() => set(field.key, list.filter((_x, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="ed-btn small" disabled={list.length >= 50} onClick={() => set(field.key, [...list, ''])}>
            Добавить зону
          </button>
        </div>
      );
    }
  }
}

/** The fields of one trigger, action or behaviour; `onChange` gets the whole part. */
export function PartForm({ spec, value, onChange, place, ctx }: { spec: PartSpec; value: Value; onChange: (v: Value) => void; place: Place | null; ctx: MakeContext }) {
  // A field that depends on another shows only when it means something: the seconds of a timer, the screen of «на выбранный экран».
  const visible = (f: SField): boolean => {
    if (spec.kind === 'timer' && value.kind !== undefined && 'mode' in value) {
      if (f.key === 'seconds') return value.mode === 'after' || value.mode === 'every';
      if (f.key === 'timerBlockId') return value.mode === 'timerEnd';
    }
    if (spec.kind === 'goTo' && f.key === 'screenId') return value.to === 'screen';
    return true;
  };
  return (
    <div className="ed-layer-fields" data-part={spec.kind}>
      {spec.fields.filter(visible).map((f) => (
        <Field key={f.key} field={f} value={value} onChange={(v) => onChange(spec.normalize ? spec.normalize(v, ctx) : v)} place={place} ctx={ctx} />
      ))}
    </div>
  );
}

// ── The list of actions of a rule (and of a branch, a repeat) ─────────────────
export function ActionList({ label, owner, ruleId, path, actions }: { label: string; owner: RuleOwner; ruleId: string; path: ListPath; actions: Action[] }) {
  const doc = useEditor((s) => s.doc);
  const apply = useEditor((s) => s.apply);
  const screenId = useEditor((s) => s.selection.screenId);
  const selfId = useEditor((s) => (owner.kind === 'block' ? owner.blockId : (s.selection.blockIds[0] ?? s.doc.screens[0]?.blocks[0]?.id ?? '')));
  const [open, setOpen] = useState<number | null>(null);
  // The order of actions is changed by dragging a row by its handle (and by the arrows, which also work with a finger).
  const dragFrom = useRef<number | null>(null);
  const names = namesOf(doc);
  const ctx: MakeContext = { doc, self: selfId, screenId };
  const lastOfRule = path.length === 0 || path[path.length - 1] === 'do';
  return (
    <div className="ed-layer ed-actions-list" role="group" aria-label={label}>
      <strong>{label}</strong>
      {actions.length === 0 && <p className="ed-hint">Действий нет.</p>}
      {actions.map((action, index) => {
        const spec = ACTIONS.find((s) => s.kind === action.kind)!;
        const isOpen = open === index;
        return (
          <div
            key={index}
            className="ed-layer"
            data-action={action.kind}
            onDragOver={(e) => dragFrom.current !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const from = dragFrom.current;
              dragFrom.current = null;
              if (from !== null && from !== index) apply(moveAction(owner, ruleId, path, from, index), { label: 'Порядок действий' });
            }}
          >
            <div className="ed-layerhead">
              <span
                className="ed-grip"
                role="img"
                aria-label={`Действие ${index + 1}: потяните, чтобы переставить`}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  dragFrom.current = index;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(index));
                }}
                onDragEnd={() => (dragFrom.current = null)}
              >
                ⋮⋮
              </span>
              <button type="button" className="ed-link" aria-expanded={isOpen} aria-label={`Действие ${index + 1}: ${spec.title}`} onClick={() => setOpen(isOpen ? null : index)}>
                {index + 1}. {describeAction(action, names)}
              </button>
              <span className="ed-row">
                <button type="button" className="ed-btn small" aria-label={`Действие ${index + 1}: выше`} disabled={index === 0} onClick={() => apply(moveAction(owner, ruleId, path, index, index - 1), { label: 'Порядок действий' })}>
                  ↑
                </button>
                <button type="button" className="ed-btn small" aria-label={`Действие ${index + 1}: ниже`} disabled={index === actions.length - 1} onClick={() => apply(moveAction(owner, ruleId, path, index, index + 1), { label: 'Порядок действий' })}>
                  ↓
                </button>
                <button type="button" className="ed-btn small" aria-label={`Действие ${index + 1}: удалить`} disabled={lastOfRule && actions.length === 1} onClick={() => apply(removeAction(owner, ruleId, path, index), { label: 'Удалить действие' })}>
                  ✕
                </button>
              </span>
            </div>
            {isOpen && (
              <>
                <SelectInput<string>
                  control={`action-kind:${index}`}
                  label={`Действие ${index + 1}: что сделать`}
                  value={action.kind}
                  options={ACTIONS.map((s) => [s.kind, s.title] as const)}
                  onChange={(k) => apply(setAction(owner, ruleId, path, index, ACTIONS.find((s) => s.kind === k)!.make(ctx) as Action), { label: 'Вид действия' })}
                />
                <PartForm spec={spec} value={action} ctx={ctx} place={{ owner, ruleId, path, index }} onChange={(v) => apply(setAction(owner, ruleId, path, index, v as unknown as Action), { label: `Действие: ${spec.title}`, mergeKey: `action:${ruleId}:${path.join('.')}:${index}` })} />
              </>
            )}
          </div>
        );
      })}
      <AddAction label={label} ctx={ctx} onAdd={(a) => { apply(addAction(owner, ruleId, path, a), { label: 'Новое действие' }); setOpen(actions.length); }} disabled={actions.length >= 50} />
    </div>
  );
}

export function AddAction({ label, ctx, onAdd, disabled }: { label: string; ctx: MakeContext; onAdd: (a: Action) => void; disabled?: boolean }) {
  return (
    <SelectInput<string>
      control={`add-action:${label}`}
      label={`${label}: добавить действие`}
      value={NONE}
      options={[[NONE, disabled ? 'Больше 50 действий нельзя' : 'Добавить действие…'], ...ACTIONS.map((s) => [s.kind, s.title] as const)]}
      onChange={(k) => k !== NONE && !disabled && onAdd(ACTIONS.find((s) => s.kind === k)!.make(ctx) as Action)}
    />
  );
}

