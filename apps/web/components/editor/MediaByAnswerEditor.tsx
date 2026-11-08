'use client';
import { type MediaByAnswer, type Screen, walkBlocks } from '@blokum/schema';
import { setMediaByAnswer } from '../../lib/editor/commands';
import { Toggle, SelectInput } from './controls';
import { useEditor } from './context';
import { BlockPick, OptionPick, OverlayField } from './ScenarioForm';

type Case = MediaByAnswer['cases'][number];

const WHEN: ReadonlyArray<readonly [string, string]> = [
  ['correct', 'ответ верный'],
  ['wrong', 'ответ неверный'],
  ['option', 'выбран вариант'],
];
const EMPTY_OVERLAY = { media: { source: 'media', id: 'media_unset' }, seconds: 1.5, skippable: true } as const;

/** T-21 · «Мем по ответу»: a different media insert on the way out of the screen, depending on the answer to its question. */
export function MediaByAnswerEditor({ screen }: { screen: Screen }) {
  const apply = useEditor((s) => s.apply);
  const rule = screen.mediaByAnswer;
  const questions = [...walkBlocks(screen.blocks)].filter((b) => b.type === 'singleChoice' || b.type === 'multiChoice');
  // «Выбран вариант» начинается с первого варианта вопроса: пустой вариант схема не принимает.
  const asked = rule ? questions.find((b) => b.id === rule.questionBlockId) : undefined;
  const firstOption = (asked?.props as { options?: Array<{ id: string }> } | undefined)?.options?.[0]?.id ?? '';
  const write = (next: MediaByAnswer | undefined) => apply(setMediaByAnswer(screen.id, next), { label: 'Мем по ответу' });
  const setCase = (i: number, patch: Partial<Case>) => rule && write({ ...rule, cases: rule.cases.map((c, j) => (j === i ? ({ ...c, ...patch }) : c)) });

  return (
    <div data-testid="media-by-answer">
      {questions.length === 0 && !rule && <p className="ed-hint">Добавьте на экран вопрос с вариантами — тогда для каждого ответа можно показать свой мем.</p>}
      {(questions.length > 0 || rule) && (
        <Toggle
          control="media-by-answer:on"
          label="Свой мем для ответа"
          value={rule !== undefined}
          onChange={(on) => write(on ? { questionBlockId: questions[0]!.id, cases: [{ when: { kind: 'correct' }, overlay: { ...EMPTY_OVERLAY } }] } : undefined)}
        />
      )}
      {rule && (
        <>
          <BlockPick label="Мем по ответу: вопрос" value={rule.questionBlockId} types={['singleChoice', 'multiChoice']} onChange={(id) => write({ ...rule, questionBlockId: id, cases: rule.cases.map((c) => (c.when.kind === 'option' ? { ...c, when: { kind: 'correct' as const } } : c)) })} />
          {rule.cases.map((c, i) => (
            <div key={i} className="ed-layer" role="group" aria-label={`Случай ${i + 1}`}>
              <strong>Случай {i + 1}</strong>
              <SelectInput<string>
                control={`media-by-answer:${i}:when`}
                label={`Случай ${i + 1}: когда`}
                value={c.when.kind}
                options={WHEN}
                onChange={(kind) => setCase(i, { when: kind === 'option' ? { kind: 'option', optionId: firstOption } : { kind: kind as 'correct' | 'wrong' } })}
              />
              {c.when.kind === 'option' && (
                <OptionPick label={`Случай ${i + 1}: вариант`} value={c.when.optionId} questionId={rule.questionBlockId} onChange={(id) => id && setCase(i, { when: { kind: 'option', optionId: id } })} />
              )}
              <OverlayField label={`Случай ${i + 1}: мем`} value={c.overlay} onChange={(overlay) => setCase(i, { overlay } as Partial<Case>)} />
              <button type="button" className="ed-btn small danger" aria-label={`Случай ${i + 1}: убрать`} disabled={rule.cases.length <= 1} onClick={() => write({ ...rule, cases: rule.cases.filter((_x, j) => j !== i) })}>
                Убрать
              </button>
            </div>
          ))}
          <button type="button" className="ed-btn small" disabled={rule.cases.length >= 30} onClick={() => write({ ...rule, cases: [...rule.cases, { when: { kind: 'wrong' }, overlay: { ...EMPTY_OVERLAY } }] })}>
            Добавить случай
          </button>
        </>
      )}
    </div>
  );
}
