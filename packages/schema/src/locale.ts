import { z } from 'zod';

// Every validation message that can reach a user is in Russian (N-05) and has no English words (CLAUDE.md):
// the stock zod Russian locale prints type names («array», «string») and enum values, so the messages are
// written here. Importing @blokum/schema installs them once for the whole process.

const plural = (n: number, one: string, few: string, many: string): string => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
};

const TYPES: Record<string, string> = {
  string: 'текст',
  number: 'число',
  int: 'целое число',
  bigint: 'число',
  nan: 'число',
  boolean: 'да или нет',
  object: 'набор полей',
  array: 'список',
  date: 'дата',
  undefined: 'пустое значение',
  null: 'пустое значение',
  symbol: 'значение',
  function: 'значение',
  map: 'набор значений',
  set: 'набор значений',
  file: 'файл',
};

const typeName = (t: string): string => TYPES[t] ?? 'значение';

const FORMATS: Record<string, string> = {
  email: 'Неверный адрес почты',
  url: 'Неверная ссылка',
  datetime: 'Неверная дата и время',
  date: 'Неверная дата',
  time: 'Неверное время',
  uuid: 'Неверный идентификатор',
  regex: 'Неверный формат',
};

type Issue = z.core.$ZodRawIssue;

function sizeMessage(issue: Issue & { origin?: string }, limit: number, big: boolean, inclusive: boolean): string {
  const origin = issue.origin;
  if (origin === 'string') {
    if (!big && limit === 1) return 'Заполните поле';
    const unit = plural(limit, 'символа', 'символов', 'символов');
    return big ? `Слишком длинный текст: не больше ${limit} ${unit}` : `Слишком короткий текст: не меньше ${limit} ${unit}`;
  }
  if (origin === 'array' || origin === 'set') {
    const unit = plural(limit, 'элемента', 'элементов', 'элементов');
    return big ? `Слишком много элементов: не больше ${limit}` : `Нужно не меньше ${limit} ${unit}`;
  }
  if (origin === 'file') return big ? `Файл слишком большой: не больше ${limit} байт` : `Файл слишком маленький`;
  if (origin === 'date') return big ? 'Дата слишком поздняя' : 'Дата слишком ранняя';
  if (big) return inclusive ? `Число должно быть не больше ${limit}` : `Число должно быть меньше ${limit}`;
  return inclusive ? `Число должно быть не меньше ${limit}` : `Число должно быть больше ${limit}`;
}

/** Russian messages for every kind of zod issue. */
export function russianIssueMessage(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'Поле не заполнено' : `Неверный тип значения: нужно «${typeName(String(issue.expected))}»`;
    case 'invalid_value':
      return 'Недопустимое значение';
    case 'too_big':
      return sizeMessage(issue, Number(issue.maximum), true, issue.inclusive ?? true);
    case 'too_small':
      return sizeMessage(issue, Number(issue.minimum), false, issue.inclusive ?? true);
    case 'invalid_format':
      return FORMATS[issue.format] ?? 'Неверный формат';
    case 'not_multiple_of':
      return `Число должно быть кратно ${String(issue.divisor)}`;
    case 'unrecognized_keys':
      return issue.keys.length > 1 ? 'Лишние поля в данных' : 'Лишнее поле в данных';
    case 'invalid_key':
    case 'invalid_element':
      return 'Неверное значение в списке';
    default:
      return 'Неверные данные';
  }
}

// `jitless`: zod does not probe whether `Function` works (it would be a violation of the CSP, N-04) and parses without generated code.
z.config({ localeError: russianIssueMessage, jitless: true });

export { z };
