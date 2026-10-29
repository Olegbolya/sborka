'use client';
import { SYSTEM_VARIABLES, type Variable } from '@blokum/schema';
import { useState } from 'react';
import { addVariableOf, listToText, nameProblem, removeVariable, renameVariable, setVariableInitial, setVariableSave, setVariableType, textToList, variableUsage, type VariableType } from '../../lib/editor/variables';
import { VARIABLE_TYPES } from '../../lib/editor/scenario-specs';
import { NumberInput, SelectInput, TextInput, Toggle } from './controls';
import { useEditor } from './context';

const TYPE_OPTIONS = VARIABLE_TYPES.map((t) => [t.type, t.title] as const);
const SYSTEM_TITLES: Record<(typeof SYSTEM_VARIABLES)[number], string> = {
  время_прохождения: 'сколько времени идёт прохождение',
  время_на_экране: 'сколько участник на этом экране',
  номер_экрана: 'номер текущего экрана',
  баллы: 'набранные баллы',
  имя_участника: 'имя участника, если он назвался',
};

function ValueInput({ variable, onChange }: { variable: Variable; onChange: (v: Variable['initial']) => void }) {
  const label = `Начальное значение «${variable.name}»`;
  if (variable.type === 'number') return <NumberInput control={`var:${variable.id}:initial`} label={label} value={variable.initial as number} min={-1000000} max={1000000} onChange={onChange} />;
  if (variable.type === 'bool') return <Toggle control={`var:${variable.id}:initial`} label={`${label}: да`} value={variable.initial as boolean} onChange={onChange} />;
  if (variable.type === 'list') return <TextInput control={`var:${variable.id}:initial`} label={`${label}: через запятую`} value={listToText(variable.initial as Array<number | string>)} max={4000} onChange={(t) => onChange(textToList(t))} />;
  return <TextInput control={`var:${variable.id}:initial`} label={label} value={variable.initial as string} max={1000} onChange={onChange} />;
}

/** VR-01…VR-04 · the variables of the assembly: name, type, starting value, «записывать в ответы». */
export function VariablesPanel() {
  const doc = useEditor((s) => s.doc);
  const apply = useEditor((s) => s.apply);
  const [name, setName] = useState('');
  const [type, setType] = useState<VariableType>('number');
  const problem = name.trim() === '' ? null : nameProblem(doc, name);
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  return (
    <div className="ed-section" data-testid="variables-panel">
      <h2>Переменные</h2>
      <p className="ed-hint">Переменная помнит число, текст, «да/нет» или список. Её меняют правила, её можно показать на экране блоком «Значение».</p>
      {doc.variables.length === 0 && <p className="ed-hint">Переменных пока нет.</p>}
      {doc.variables.map((v) => {
        const used = variableUsage(doc, v.id);
        const draft = renaming[v.id];
        const bad = draft !== undefined ? nameProblem(doc, draft, v.id) : null;
        return (
          <div key={v.id} className="ed-layer" data-variable={v.name}>
            <TextInput
              control={`var:${v.id}:name`}
              label={`Имя переменной «${v.name}»`}
              value={draft ?? v.name}
              max={40}
              onChange={(t) => {
                setRenaming({ ...renaming, [v.id]: t });
                if (!nameProblem(doc, t, v.id)) apply(renameVariable(v.id, t), { label: 'Имя переменной', mergeKey: `var-name:${v.id}` });
              }}
            />
            {bad && (
              <p role="alert" className="ed-hint">
                {bad}
              </p>
            )}
            <SelectInput<VariableType> control={`var:${v.id}:type`} label={`Тип «${v.name}»`} value={v.type} options={TYPE_OPTIONS} onChange={(t) => apply(setVariableType(v.id, t), { label: 'Тип переменной' })} />
            <ValueInput variable={v} onChange={(initial) => apply(setVariableInitial(v.id, initial), { label: 'Начальное значение', mergeKey: `var-initial:${v.id}` })} />
            <Toggle control={`var:${v.id}:save`} label={`Записывать «${v.name}» в ответы`} value={v.saveToAnswers} onChange={(save) => apply(setVariableSave(v.id, save), { label: 'Запись в ответы' })} />
            <p className="ed-hint">{used === 0 ? 'Нигде не используется.' : `Используется в ${used} местах.`}</p>
            <button type="button" className="ed-btn small" aria-label={`Удалить переменную «${v.name}»`} onClick={() => apply(removeVariable(v.id), { label: 'Удалить переменную' })}>
              {used > 0 ? `Удалить (сломает ${used})` : 'Удалить'}
            </button>
          </div>
        );
      })}
      <div className="ed-layer" role="group" aria-label="Новая переменная">
        <strong>Новая переменная</strong>
        <TextInput control="var:new:name" label="Имя новой переменной" value={name} max={40} placeholder="Например, Очки" onChange={setName} />
        {problem && (
          <p role="alert" className="ed-hint">
            {problem}
          </p>
        )}
        <SelectInput<VariableType> control="var:new:type" label="Тип новой переменной" value={type} options={TYPE_OPTIONS} onChange={setType} />
        <button
          type="button"
          className="ed-btn"
          disabled={name.trim() === '' || problem !== null}
          onClick={() => {
            apply(addVariableOf(name, type), { label: 'Новая переменная' });
            setName('');
          }}
        >
          Добавить переменную
        </button>
      </div>
      <h2>Встроенные</h2>
      <p className="ed-hint">Их считает сам плеер, их можно подставлять в тексты и условия, но не менять.</p>
      <ul className="ed-hint">
        {SYSTEM_VARIABLES.map((n) => (
          <li key={n}>
            <strong>{n}</strong> — {SYSTEM_TITLES[n]}
          </li>
        ))}
      </ul>
    </div>
  );
}
