import { type Block, plainText } from '@blokum/schema';
import { CARD_WARNING, looksLikeCardNumber } from './card.js';
import { FlowError } from './errors.js';

/** Answer of a participant to one question block, as stored in the session and sent to the API. */
export type AnswerValue =
  | { kind: 'choice'; optionIds: string[] }
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'swipe'; value: 'left' | 'right' }
  | { kind: 'ranking'; order: string[] }
  | { kind: 'contacts'; values: Partial<Record<ContactField, string>> }
  | { kind: 'consent'; value: boolean };

export type ContactField = 'name' | 'phone' | 'email' | 'city';
export type QuestionBlock = Extract<
  Block,
  { type: 'singleChoice' | 'multiChoice' | 'textInput' | 'scale' | 'swipe' | 'ranking' | 'date' | 'contacts' | 'consent' }
>;

const QUESTION_KINDS: Record<QuestionBlock['type'], AnswerValue['kind']> = {
  singleChoice: 'choice',
  multiChoice: 'choice',
  textInput: 'text',
  date: 'text',
  scale: 'number',
  swipe: 'swipe',
  ranking: 'ranking',
  contacts: 'contacts',
  consent: 'consent',
};

export function isQuestion(b: Block): b is QuestionBlock {
  return b.type in QUESTION_KINDS;
}

const fail = (message: string): never => {
  throw new FlowError('INVALID_ANSWER', message);
};

/** Precision-safe check that `value` lies on the scale grid min + k·step. */
const onStep = (value: number, min: number, step: number) => {
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < 1e-9;
};

/**
 * Checks an answer against its question and returns a normalised copy (trimmed text, unique ids).
 * The server calls this for every answer (PL-15): the participant's browser is never trusted.
 */
export function normalizeAnswer(block: QuestionBlock, answer: AnswerValue): AnswerValue {
  if (QUESTION_KINDS[block.type] !== answer.kind) fail(`Ответ не подходит к вопросу «${block.name}»`);
  switch (block.type) {
    case 'singleChoice':
    case 'multiChoice': {
      const a = answer as Extract<AnswerValue, { kind: 'choice' }>;
      const ids = [...new Set(a.optionIds)];
      const known = new Set(block.props.options.map((o) => o.id));
      if (ids.some((id) => !known.has(id))) fail('Такого варианта ответа нет');
      if (block.type === 'singleChoice' && ids.length > 1) fail('Здесь можно выбрать только один вариант');
      if (block.type === 'multiChoice' && block.props.maxSelected !== undefined && ids.length > block.props.maxSelected)
        fail(`Можно выбрать не больше ${block.props.maxSelected}`);
      return { kind: 'choice', optionIds: ids };
    }
    case 'textInput': {
      const value = (answer as Extract<AnswerValue, { kind: 'text' }>).value.trim();
      if (value.length > block.props.maxLength) fail(`Ответ длиннее ${block.props.maxLength} символов`);
      if (block.props.mask === 'number' && value !== '' && !/^-?\d+([.,]\d+)?$/.test(value)) fail('Введите число');
      if (looksLikeCardNumber(value)) throw new FlowError('CARD_LIKE', CARD_WARNING);
      return { kind: 'text', value };
    }
    case 'date': {
      const value = (answer as Extract<AnswerValue, { kind: 'text' }>).value.trim();
      const pattern = { date: /^\d{4}-\d{2}-\d{2}$/, time: /^\d{2}:\d{2}$/, datetime: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ }[block.props.mode];
      if (value !== '' && !pattern.test(value)) fail('Неверный формат даты');
      if (value !== '' && block.props.min && value < block.props.min) fail(`Дата не раньше ${block.props.min}`);
      if (value !== '' && block.props.max && value > block.props.max) fail(`Дата не позже ${block.props.max}`);
      return { kind: 'text', value };
    }
    case 'scale': {
      const { value } = answer as Extract<AnswerValue, { kind: 'number' }>;
      const { min, max, step } = block.props;
      if (!Number.isFinite(value) || value < min || value > max || !onStep(value, min, step)) fail(`Выберите значение от ${min} до ${max}`);
      return { kind: 'number', value };
    }
    case 'swipe': {
      const { value } = answer as Extract<AnswerValue, { kind: 'swipe' }>;
      if (value !== 'left' && value !== 'right') fail('Смахните карточку влево или вправо');
      return { kind: 'swipe', value };
    }
    case 'ranking': {
      const { order } = answer as Extract<AnswerValue, { kind: 'ranking' }>;
      const items = block.props.items.map((i) => i.id);
      if (order.length !== items.length || new Set(order).size !== order.length || order.some((id) => !items.includes(id)))
        fail('Расставьте все пункты по порядку');
      return { kind: 'ranking', order: [...order] };
    }
    case 'contacts': {
      const { values } = answer as Extract<AnswerValue, { kind: 'contacts' }>;
      const out: Partial<Record<ContactField, string>> = {};
      for (const [field, raw] of Object.entries(values) as Array<[ContactField, string | undefined]>) {
        if (!block.props.fields.includes(field)) fail('Лишнее поле в контактах');
        const v = (raw ?? '').trim();
        if (v.length > 200) fail('Слишком длинное значение в контактах');
        if (v === '') continue;
        if (looksLikeCardNumber(v)) throw new FlowError('CARD_LIKE', CARD_WARNING);
        if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('Проверьте адрес почты');
        if (field === 'phone' && !/^\+?[\d\s()-]{7,20}$/.test(v)) fail('Проверьте номер телефона');
        out[field] = v;
      }
      return { kind: 'contacts', values: out };
    }
    case 'consent':
      return { kind: 'consent', value: (answer as Extract<AnswerValue, { kind: 'consent' }>).value === true };
  }
}

/** True if the answer carries anything (an empty text or no selected options is «no answer»). */
export function isAnswered(answer: AnswerValue | undefined): boolean {
  if (!answer) return false;
  switch (answer.kind) {
    case 'choice':
      return answer.optionIds.length > 0;
    case 'text':
      return answer.value.trim() !== '';
    case 'contacts':
      return Object.values(answer.values).some((v) => (v ?? '').trim() !== '');
    case 'consent':
      return answer.value;
    default:
      return true;
  }
}

/** Russian message if the question blocks moving on (L-07); null when it is fine. */
export function requiredProblem(block: QuestionBlock, answer: AnswerValue | undefined, personalDataGiven: boolean): string | null {
  const answered = isAnswered(answer);
  switch (block.type) {
    case 'consent':
      // Consent is needed only when the participant actually leaves personal data on this screen (05-LEGAL.md §2.4).
      return personalDataGiven && !answered ? 'Чтобы отправить контакты, отметьте согласие на обработку персональных данных' : null;
    case 'multiChoice': {
      const n = answer?.kind === 'choice' ? answer.optionIds.length : 0;
      if (block.props.required && n === 0) return 'Выберите ответ';
      if (n > 0 && n < block.props.minSelected) return `Выберите не меньше ${block.props.minSelected}`;
      return null;
    }
    case 'textInput': {
      const len = answer?.kind === 'text' ? answer.value.length : 0;
      if (block.props.required && !answered) return 'Заполните ответ';
      if (answered && len < block.props.minLength) return `Ответ короче ${block.props.minLength} символов`;
      return null;
    }
    case 'contacts': {
      if (!block.props.required) return null;
      const values = answer?.kind === 'contacts' ? answer.values : {};
      const missing = block.props.fields.filter((f) => !values[f]);
      return missing.length ? 'Заполните все поля контактов' : null;
    }
    default:
      return block.props.required && !answered ? 'Ответьте на вопрос' : null;
  }
}

/** True if the answer contains personal data (contacts or a text field marked as name/phone/e-mail/city). */
export function hasPersonalData(block: QuestionBlock, answer: AnswerValue | undefined): boolean {
  if (block.type === 'contacts') return isAnswered(answer);
  return block.type === 'textInput' && block.props.semantic !== 'none' && isAnswered(answer);
}

/** Text of a choice option as the participant sees it (text of its block, otherwise the block name). */
export function optionLabel(block: Extract<Block, { type: 'singleChoice' | 'multiChoice' }>, optionId: string): string {
  const option = block.props.options.find((o) => o.id === optionId);
  const child = block.children.find((c) => c.id === option?.blockId);
  if (!child) return '';
  const text = child.textLayer ? plainText(child.textLayer).trim() : '';
  return text || child.name;
}
