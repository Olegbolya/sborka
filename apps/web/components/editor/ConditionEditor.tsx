'use client';
import { type Condition, COMPARE_OPS } from '@blokum/schema';
import { blocksOf, questionsOf } from '../../lib/editor/logic';
import { NumberInput, SelectInput, TextInput, Toggle } from './controls';
import { useEditor } from './context';

/** CN-01…CN-06 · the whole language of conditions as a form: every kind of the schema is a choice here, groups nest. */

type Leaf = Exclude<Condition, { kind: 'group' }>;
type Kind = Leaf['kind'] | 'group';
type Op = (typeof COMPARE_OPS)[number];

const KIND_TITLES: ReadonlyArray<readonly [Kind, string]> = [
  ['variable', 'Значение переменной'],
  ['answer', 'Ответ на вопрос'],
  ['blockState', 'Состояние блока'],
  ['ruleCount', 'Сколько правил сработало'],
  ['chance', 'Случайность'],
  ['group', 'Несколько условий вместе'],
];

/** The kinds the editor of conditions offers (CN-01…CN-06): the test compares them with the schema. */
export const CONDITION_KINDS: readonly Kind[] = KIND_TITLES.map(([k]) => k);

const OP_TITLES: Record<Op, string> = { eq: 'равно', ne: 'не равно', gt: 'больше', lt: 'меньше', gte: 'не меньше', lte: 'не больше', contains: 'содержит', empty: 'пусто' };
const COUNT_OPS = COMPARE_OPS.filter((o) => o !== 'contains' && o !== 'empty');
const opOptions = (ops: readonly Op[]) => ops.map((o) => [o, OP_TITLES[o]] as const);

const ANSWER_OPS: ReadonlyArray<readonly [string, string]> = [
  ['selected', 'выбран вариант'],
  ['notSelected', 'не выбран вариант'],
  ['eq', 'ответ равен'],
  ['contains', 'ответ содержит'],
  ['empty', 'ответа нет'],
  ['scoreGte', 'баллы за ответ не меньше'],
  ['scoreLte', 'баллы за ответ не больше'],
  ['correct', 'ответ верный'],
  ['wrong', 'ответ неверный'],
];

const STATE_TITLES: ReadonlyArray<readonly [string, string]> = [
  ['visible', 'виден'],
  ['hidden', 'скрыт'],
  ['selected', 'выбран'],
  ['onZone', 'лежит на зоне'],
  ['dragging', 'перетаскивается'],
  ['copiesCount', 'число копий'],
];

const GROUP_OPS: ReadonlyArray<readonly [string, string]> = [
  ['and', 'выполнены все (И)'],
  ['or', 'выполнено любое (ИЛИ)'],
  ['not', 'не выполнено ни одно (НЕ)'],
];

const UNSET = '';

/** A condition of a given kind with values that mean something: the first variable, question or block of the document. */
export function newCondition(kind: Kind, ctx: { variableIds: string[]; questionIds: string[]; blockIds: string[] }): Condition {
  switch (kind) {
    case 'variable':
      return { kind, variableId: ctx.variableIds[0] ?? 'variable_unset', op: 'gte', value: 1 };
    case 'answer':
      return { kind, questionBlockId: ctx.questionIds[0] ?? 'question_unset', op: 'empty' };
    case 'blockState':
      return { kind, blockId: ctx.blockIds[0] ?? 'block_unset', state: 'visible' };
    case 'ruleCount':
      return { kind, op: 'gte', value: 1 };
    case 'chance':
      return { kind, percent: 50, affectsResult: false };
    case 'group':
      return { kind, op: 'and', items: [newCondition('variable', ctx)] };
  }
}

export function ConditionEditor({ value, onChange, label, onRemove }: { value: Condition; onChange: (c: Condition) => void; label: string; onRemove?: () => void }) {
  const doc = useEditor((s) => s.doc);
  const variables = doc.variables;
  const questions = questionsOf(doc);
  const blocks = blocksOf(doc);
  const ctx = { variableIds: variables.map((v) => v.id), questionIds: questions.map((q) => q.id), blockIds: blocks.map((b) => b.id) };
  const kind = value.kind;

  const kindSelect = (
    <SelectInput<Kind>
      control={`${label}.kind`}
      label={`${label}: что проверяем`}
      value={kind}
      options={KIND_TITLES}
      onChange={(k) => k !== kind && onChange(k === 'group' ? { kind: 'group', op: 'and', items: [value] } : newCondition(k, ctx))}
    />
  );
  const remove = onRemove && (
    <button type="button" className="ed-btn small danger" aria-label={`${label}: убрать условие`} onClick={onRemove}>
      Убрать
    </button>
  );

  if (value.kind === 'group') {
    const set = (items: Condition[]) => onChange({ ...value, items });
    return (
      <div className="ed-layer" data-condition="group">
        <div className="ed-layerhead">
          <strong>{label}</strong>
          {remove}
        </div>
        {kindSelect}
        <SelectInput<string> control={`${label}.op`} label={`${label}: когда`} value={value.op} options={GROUP_OPS} onChange={(op) => onChange({ ...value, op: op as 'and' | 'or' | 'not' })} />
        {value.items.map((item, i) => (
          <ConditionEditor
            key={i}
            label={`${label}.${i + 1}`}
            value={item}
            onChange={(c) => set(value.items.map((x, j) => (j === i ? c : x)))}
            {...(value.items.length > 1 ? { onRemove: () => set(value.items.filter((_x, j) => j !== i)) } : {})}
          />
        ))}
        <button type="button" className="ed-btn small" disabled={value.items.length >= 30} aria-label={`${label}: добавить условие`} onClick={() => set([...value.items, newCondition('variable', ctx)])}>
          Добавить условие
        </button>
      </div>
    );
  }

  const known = (id: string, list: Array<{ id: string }>) => (list.some((x) => x.id === id) ? id : UNSET);

  if (value.kind === 'variable') {
    const variable = variables.find((v) => v.id === value.variableId);
    const needsValue = value.op !== 'empty';
    return (
      <div className="ed-layer" data-condition="variable">
        <div className="ed-layerhead">
          <strong>{label}</strong>
          {remove}
        </div>
        {kindSelect}
        <SelectInput<string>
          control={`${label}.variable`}
          label={`${label}: переменная`}
          value={known(value.variableId, variables)}
          options={[[UNSET, 'Выберите переменную'], ...variables.map((v) => [v.id, v.name] as const)]}
          onChange={(id) => id !== UNSET && onChange({ ...value, variableId: id })}
        />
        <SelectInput<Op> control={`${label}.op`} label={`${label}: как сравнить`} value={value.op} options={opOptions(COMPARE_OPS)} onChange={(op) => onChange({ kind: 'variable', variableId: value.variableId, op, ...(op === 'empty' || value.value === undefined ? {} : { value: value.value }) })} />
        {needsValue &&
          (variable?.type === 'number' || (variable === undefined && typeof value.value === 'number') ? (
            <NumberInput control={`${label}.value`} label={`${label}: значение`} value={typeof value.value === 'number' ? value.value : 0} step={1} onChange={(n) => onChange({ ...value, value: n })} />
          ) : variable?.type === 'bool' ? (
            <Toggle control={`${label}.value`} label={`${label}: значение «да»`} value={value.value === true} onChange={(v) => onChange({ ...value, value: v })} />
          ) : (
            <TextInput control={`${label}.value`} label={`${label}: значение`} value={typeof value.value === 'string' ? value.value : ''} max={1000} onChange={(v) => onChange({ ...value, value: v })} />
          ))}
      </div>
    );
  }

  if (value.kind === 'answer') {
    const q = questions.find((x) => x.id === value.questionBlockId);
    const needsOption = value.op === 'selected' || value.op === 'notSelected';
    const needsValue = ['eq', 'contains', 'scoreGte', 'scoreLte'].includes(value.op);
    const numeric = value.op === 'scoreGte' || value.op === 'scoreLte';
    return (
      <div className="ed-layer" data-condition="answer">
        <div className="ed-layerhead">
          <strong>{label}</strong>
          {remove}
        </div>
        {kindSelect}
        <SelectInput<string>
          control={`${label}.question`}
          label={`${label}: вопрос`}
          value={known(value.questionBlockId, questions)}
          options={[[UNSET, 'Выберите вопрос'], ...questions.map((x) => [x.id, `${x.name} (${x.screen})`] as const)]}
          onChange={(id) => id !== UNSET && onChange({ kind: 'answer', questionBlockId: id, op: value.op === 'selected' || value.op === 'notSelected' ? 'empty' : value.op })}
        />
        <SelectInput<string>
          control={`${label}.op`}
          label={`${label}: условие на ответ`}
          value={value.op}
          options={ANSWER_OPS}
          onChange={(op) => onChange({ kind: 'answer', questionBlockId: value.questionBlockId, op: op as typeof value.op, ...(op === 'selected' || op === 'notSelected' ? { optionId: q?.options[0]?.id ?? 'option_unset' } : {}), ...(op === 'scoreGte' || op === 'scoreLte' ? { value: 0 } : {}) })}
        />
        {needsOption && (
          <SelectInput<string>
            control={`${label}.option`}
            label={`${label}: вариант`}
            value={q?.options.some((o) => o.id === value.optionId) ? (value.optionId ?? UNSET) : UNSET}
            options={[[UNSET, 'Выберите вариант'], ...(q?.options ?? []).map((o) => [o.id, o.label] as const)]}
            onChange={(id) => id !== UNSET && onChange({ ...value, optionId: id })}
          />
        )}
        {needsValue &&
          (numeric ? (
            <NumberInput control={`${label}.value`} label={`${label}: значение`} value={typeof value.value === 'number' ? value.value : 0} step={1} onChange={(n) => onChange({ ...value, value: n })} />
          ) : (
            <TextInput control={`${label}.value`} label={`${label}: значение`} value={typeof value.value === 'string' ? value.value : ''} max={1000} onChange={(v) => onChange({ ...value, value: v })} />
          ))}
      </div>
    );
  }

  if (value.kind === 'blockState') {
    return (
      <div className="ed-layer" data-condition="blockState">
        <div className="ed-layerhead">
          <strong>{label}</strong>
          {remove}
        </div>
        {kindSelect}
        <SelectInput<string>
          control={`${label}.block`}
          label={`${label}: блок`}
          value={known(value.blockId, blocks)}
          options={[[UNSET, 'Выберите блок'], ...blocks.map((b) => [b.id, `${b.name} (${b.screen})`] as const)]}
          onChange={(id) => id !== UNSET && onChange({ ...value, blockId: id })}
        />
        <SelectInput<string>
          control={`${label}.state`}
          label={`${label}: состояние`}
          value={value.state}
          options={STATE_TITLES}
          onChange={(state) => onChange({ kind: 'blockState', blockId: value.blockId, state: state as typeof value.state, ...(state === 'onZone' ? { zoneId: blocks.find((b) => b.type === 'zone')?.id ?? 'zone_unset' } : {}), ...(state === 'copiesCount' ? { op: 'gte' as const, value: 1 } : {}) })}
        />
        {value.state === 'onZone' && (
          <SelectInput<string>
            control={`${label}.zone`}
            label={`${label}: зона`}
            value={known(value.zoneId ?? '', blocks)}
            options={[[UNSET, 'Выберите зону'], ...blocks.filter((b) => b.type === 'zone').map((b) => [b.id, b.name] as const)]}
            onChange={(id) => id !== UNSET && onChange({ ...value, zoneId: id })}
          />
        )}
        {value.state === 'copiesCount' && (
          <>
            <SelectInput<Op> control={`${label}.op`} label={`${label}: как сравнить`} value={value.op ?? 'gte'} options={opOptions(COUNT_OPS)} onChange={(op) => onChange({ ...value, op })} />
            <NumberInput control={`${label}.value`} label={`${label}: число`} value={value.value ?? 1} step={1} min={0} onChange={(n) => onChange({ ...value, value: n })} />
          </>
        )}
      </div>
    );
  }

  if (value.kind === 'ruleCount') {
    return (
      <div className="ed-layer" data-condition="ruleCount">
        <div className="ed-layerhead">
          <strong>{label}</strong>
          {remove}
        </div>
        {kindSelect}
        <SelectInput<Op> control={`${label}.op`} label={`${label}: как сравнить`} value={value.op} options={opOptions(COUNT_OPS)} onChange={(op) => onChange({ ...value, op: op as typeof value.op })} />
        <NumberInput control={`${label}.value`} label={`${label}: сколько раз`} value={value.value} step={1} min={0} max={100000} onChange={(n) => onChange({ ...value, value: Math.round(n) })} />
      </div>
    );
  }

  return (
    <div className="ed-layer" data-condition="chance">
      <div className="ed-layerhead">
        <strong>{label}</strong>
        {remove}
      </div>
      {kindSelect}
      <NumberInput control={`${label}.percent`} label={`${label}: вероятность`} value={value.percent} min={0} max={100} step={1} suffix="%" onChange={(n) => onChange({ ...value, percent: n })} />
      <Toggle control={`${label}.affects`} label={`${label}: влияет на результат`} value={value.affectsResult} onChange={(v) => onChange({ ...value, affectsResult: v })} />
    </div>
  );
}
