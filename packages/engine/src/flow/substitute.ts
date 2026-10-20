import { type Block, type ProjectDocument, type RichText, type TextPlaceholder, type TextRun, walkBlocks } from '@blokum/schema';
import { type AnswerValue, isQuestion, optionLabel } from './answers.js';
import { type VariableValue } from './conditions.js';
import { type FlowState } from './navigation.js';
import { type ScoreTotals, scoreTotals } from './scoring.js';

export interface TextContext {
  doc: ProjectDocument;
  state: FlowState;
  now: number;
  /**
   * Score totals. The server computes them from the full document; the participant's browser has only the
   * public projection (no scores) and receives the totals from the server (PL-15).
   */
  totals?: ScoreTotals;
}

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** «1:05», «1:02:03». */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A variable value as text (VR-01): numbers in Russian format, lists by comma, «да»/«нет». */
export function formatValue(value: VariableValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return numberFormat.format(value);
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'number' ? numberFormat.format(v) : v)).join(', ');
  return value;
}

function findBlock(doc: ProjectDocument, id: string): Block | undefined {
  for (const s of doc.screens) for (const b of walkBlocks(s.blocks)) if (b.id === id) return b;
  return undefined;
}

/** The participant's answer as text (L-05). */
export function formatAnswer(block: Block | undefined, answer: AnswerValue | undefined): string {
  if (!block || !answer || !isQuestion(block)) return '';
  switch (answer.kind) {
    case 'choice':
      return block.type === 'singleChoice' || block.type === 'multiChoice' ? answer.optionIds.map((id) => optionLabel(block, id)).join(', ') : '';
    case 'text':
      return answer.value;
    case 'number':
      return numberFormat.format(answer.value);
    case 'swipe':
      return block.type === 'swipe' ? (answer.value === 'left' ? block.props.leftLabel : block.props.rightLabel) : '';
    case 'ranking':
      return block.type === 'ranking' ? answer.order.map((id) => block.props.items.find((i) => i.id === id)?.label ?? '').join(', ') : '';
    case 'contacts':
      return Object.values(answer.values).filter(Boolean).join(', ');
    case 'consent':
      return answer.value ? 'да' : 'нет';
  }
}

/** Name the participant gave in contacts or in a text field marked «имя». */
function participantName(doc: ProjectDocument, answers: Readonly<Record<string, AnswerValue>>): string {
  for (const s of doc.screens) {
    for (const b of walkBlocks(s.blocks)) {
      const a = answers[b.id];
      if (b.type === 'contacts' && a?.kind === 'contacts' && a.values.name) return a.values.name;
      if (b.type === 'textInput' && b.props.semantic === 'name' && a?.kind === 'text' && a.value) return a.value;
    }
  }
  return '';
}

/** Value of a system placeholder (L-04, VR-03). */
export function placeholderValue(name: TextPlaceholder, ctx: TextContext): string {
  const { doc, state, now } = ctx;
  const totals = () => ctx.totals ?? scoreTotals(doc, state.answers);
  switch (name) {
    case 'баллы':
      return numberFormat.format(totals().score);
    case 'максимум':
      return numberFormat.format(totals().max);
    case 'правильных':
      return String(totals().correct);
    case 'вопросов':
      return String(totals().keyed);
    case 'результат':
      return state.result?.key ?? '';
    case 'время_прохождения':
      return formatDuration(now - state.startedAt);
    case 'время_на_экране':
      return formatDuration(now - state.screenStartedAt);
    case 'номер_экрана':
      return String(doc.screens.findIndex((s) => s.id === state.screenId) + 1 || state.history.length + 1);
    case 'имя_участника':
      return participantName(doc, state.answers);
  }
}

function runText(run: TextRun, ctx: TextContext): string | null {
  if ('v' in run) return formatValue(ctx.state.variables[run.v]);
  if ('sys' in run) return placeholderValue(run.sys, ctx);
  if ('answer' in run) return formatAnswer(findBlock(ctx.doc, run.answer), ctx.state.answers[run.answer]);
  return null;
}

/** Text with every placeholder replaced by its value (L-04, L-05); marks of the text runs stay. */
export function substituteText(text: RichText, ctx: TextContext): RichText {
  return {
    paragraphs: text.paragraphs.map((p) => ({
      ...p,
      runs: p.runs.map((r) => {
        const value = runText(r, ctx);
        return value === null ? r : { t: value };
      }),
    })),
  };
}
