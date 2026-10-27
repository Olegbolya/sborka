'use client';
import { type Block, plainText } from '@blokum/schema';
import { useState } from 'react';
import {
  addOption,
  addVariable,
  moveOption,
  patchOption,
  removeOption,
  setOptionText,
} from '../../lib/editor/commands';
import { type EditorActions, selectedBlocks } from '../../lib/editor/store';
import { NumberInput, SelectInput, TextInput, Toggle } from './controls';
import { useEditor } from './context';

const NONE = '';

/** VR-01 · the choice of one variable of the document, or a new one made on the spot. */
export function VariableField({
  control,
  label,
  value,
  optional,
  onChange,
}: {
  control: string;
  label: string;
  value: string | null;
  optional: boolean;
  onChange: (id: string) => void;
}) {
  const apply = useEditor((s) => s.apply);
  const variables = useEditor((s) => s.doc.variables);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const known = value !== null && variables.some((v) => v.id === value);
  const create = () => {
    const clean = name.trim();
    if (variables.some((v) => v.name === clean)) return setProblem('Переменная с таким именем уже есть.');
    let created: string | null = null;
    apply(
      addVariable(clean, (id) => (created = id)),
      { label: 'Новая переменная' },
    );
    if (!created) return setProblem('Имя — буквы, цифры и «_», начинается с буквы.');
    setProblem(null);
    setName('');
    onChange(created);
  };
  return (
    <div className="ed-field" data-control={control}>
      <SelectInput<string>
        control={`${control}#select`}
        label={label}
        value={known ? value : NONE}
        options={[
          [NONE, optional ? 'Не выбрана' : 'Выберите переменную'],
          ...variables.map((v) => [v.id, v.name] as const),
        ]}
        onChange={(v) => v !== NONE && onChange(v)}
      />
      <div className="ed-colorrow">
        <input
          type="text"
          aria-label="Имя новой переменной"
          placeholder="Новая переменная"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="ed-btn small" disabled={name.trim() === ''} onClick={create}>
          Создать
        </button>
      </div>
      {problem && (
        <p className="ed-hint" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** One of the screens of the document, by name. */
export function ScreenField({ control, label, value, onChange }: { control: string; label: string; value: string | null; onChange: (id: string) => void }) {
  const screens = useEditor((s) => s.doc.screens);
  const known = value !== null && screens.some((s) => s.id === value);
  return (
    <SelectInput<string>
      control={control}
      label={label}
      value={known ? value : NONE}
      options={[[NONE, 'Выберите экран'], ...screens.map((s, i) => [s.id, `${i + 1}. ${s.name}`] as const)]}
      onChange={(v) => v !== NONE && onChange(v)}
    />
  );
}

/** T-32 · one of the transition presets of the theme of the document. */
export function TransitionPresetField({ control, label, value, onChange }: { control: string; label: string; value: string | null; onChange: (id: string) => void }) {
  const presets = useEditor((s) => s.doc.theme.tokens.transitions);
  const known = value !== null && presets.some((p) => p.id === value);
  return (
    <SelectInput<string>
      control={control}
      label={label}
      value={known ? value : NONE}
      options={[[NONE, presets.length === 0 ? 'В теме нет своих переходов' : 'Выберите переход'], ...presets.map((p) => [p.id, p.name] as const)]}
      onChange={(v) => v !== NONE && onChange(v)}
    />
  );
}

/** B-11, B-12 · the options of a question: text, right answer, score, result tags, order. */
export function OptionsEditor({ ids }: { ids: readonly string[] }) {
  const apply = useEditor((s) => s.apply);
  const block = useEditor((s) => (ids.length === 1 ? (selectedBlocks(s)[0] ?? null) : null));
  if (ids.length !== 1 || !block || (block.type !== 'singleChoice' && block.type !== 'multiChoice')) {
    return <p className="ed-hint">Чтобы изменить варианты, выберите один вопрос.</p>;
  }
  return <OptionRows block={block} apply={apply} />;
}

function OptionRows({
  block,
  apply,
}: {
  block: Extract<Block, { type: 'singleChoice' | 'multiChoice' }>;
  apply: EditorActions['apply'];
}) {
  const options = block.props.options;
  return (
    <div className="ed-field" data-control="options" role="group" aria-label="Варианты ответа">
      {options.map((o, i) => {
        const child = block.children.find((c) => c.id === o.blockId);
        return (
          <div key={o.id} className="ed-layer" data-option={i}>
            <div className="ed-layerhead">
              <strong>Вариант {i + 1}</strong>
              <button
                type="button"
                className="ed-btn small"
                aria-label={`Вариант ${i + 1}: выше`}
                disabled={i === 0}
                onClick={() => apply(moveOption(block.id, i, i - 1), { label: 'Порядок вариантов' })}
              >
                ↑
              </button>
              <button
                type="button"
                className="ed-btn small"
                aria-label={`Вариант ${i + 1}: ниже`}
                disabled={i === options.length - 1}
                onClick={() => apply(moveOption(block.id, i, i + 1), { label: 'Порядок вариантов' })}
              >
                ↓
              </button>
              <button
                type="button"
                className="ed-btn small danger"
                aria-label={`Вариант ${i + 1}: убрать`}
                disabled={options.length <= 2}
                onClick={() => apply(removeOption(block.id, o.id), { label: 'Убрать вариант' })}
              >
                Убрать
              </button>
            </div>
            <TextInput
              control={`option-${i}.text`}
              label={`Текст варианта ${i + 1}`}
              value={child?.textLayer ? plainText(child.textLayer) : ''}
              max={200}
              onChange={(v) =>
                apply(setOptionText(block.id, o.id, v), { label: 'Текст варианта', mergeKey: `option-text:${o.id}` })
              }
            />
            <Toggle
              control={`option-${i}.correct`}
              label="Правильный ответ"
              value={o.correct}
              onChange={(v) => apply(patchOption(block.id, o.id, { correct: v }), { label: 'Правильный ответ' })}
            />
            <NumberInput
              control={`option-${i}.score`}
              label="Баллы"
              value={o.score}
              min={-1000}
              max={1000}
              step={1}
              onChange={(n) =>
                apply(patchOption(block.id, o.id, { score: n }), {
                  label: 'Баллы за вариант',
                  mergeKey: `option-score:${o.id}`,
                })
              }
            />
            <TextInput
              control={`option-${i}.tags`}
              label="Метки результата (через запятую)"
              value={o.resultTags.join(', ')}
              onChange={(v) =>
                apply(patchOption(block.id, o.id, { resultTags: v.split(',') }), {
                  label: 'Метки результата',
                  mergeKey: `option-tags:${o.id}`,
                })
              }
            />
          </div>
        );
      })}
      <button
        type="button"
        className="ed-btn small"
        disabled={options.length >= 30}
        onClick={() => apply(addOption(block.id), { label: 'Добавить вариант' })}
      >
        Добавить вариант
      </button>
    </div>
  );
}
