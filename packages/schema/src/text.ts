import { z } from './locale.js';
import { Id } from './primitives.js';

/** Links in user text: only web, mail and phone links; they open through the safe-redirect page (PL-22). */
export const SafeHref = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, 'Ссылка должна начинаться с https://, http://, mailto: или tel:');

/**
 * System placeholders for texts (L-04, VR-03): «{{баллы}}», «{{максимум}}», «{{результат}}» and the
 * read-only system variables. Kept here (not in scenario.ts) so texts do not depend on scenarios.
 */
export const TEXT_PLACEHOLDERS = [
  'баллы',
  'максимум',
  'результат',
  'правильных',
  'вопросов',
  'время_прохождения',
  'время_на_экране',
  'номер_экрана',
  'имя_участника',
] as const;
export type TextPlaceholder = (typeof TEXT_PLACEHOLDERS)[number];

/** A run of text with marks (B-01) or a variable placeholder `{{имя}}` (L-05). Variables are referenced by id. */
export const TextRun = z.union([
  z.strictObject({
    t: z.string().max(5000),
    b: z.boolean().optional(),
    i: z.boolean().optional(),
    u: z.boolean().optional(),
    s: z.boolean().optional(),
    href: SafeHref.optional(),
  }),
  z.strictObject({ v: Id }),
  /** System value: score, maximum, result, time… (L-04, VR-03). */
  z.strictObject({ sys: z.enum(TEXT_PLACEHOLDERS) }),
  /** The participant's answer to a question block (L-05). */
  z.strictObject({ answer: Id }),
]);
export type TextRun = z.infer<typeof TextRun>;

export const Paragraph = z.strictObject({
  kind: z.enum(['p', 'bullet', 'ordered']).default('p'),
  runs: z.array(TextRun).max(500),
});

/** Maximum characters of text in one block (docs/02-ARCHITECTURE.md §4 п. 2). */
export const MAX_BLOCK_TEXT = 5000;

export const RichText = z
  .strictObject({ paragraphs: z.array(Paragraph).max(200) })
  .refine((rt) => plainText(rt).length <= MAX_BLOCK_TEXT, `Текст блока — не больше ${MAX_BLOCK_TEXT} символов`);
export type RichText = z.infer<typeof RichText>;

/** Text without marks; variables count as one character each. */
export function plainText(rt: { paragraphs: Array<{ runs: Array<{ t?: string } | TextRun> }> }): string {
  return rt.paragraphs.map((p) => p.runs.map((r) => ('t' in r && typeof r.t === 'string' ? r.t : '•')).join('')).join('\n');
}

/** Helper for factories and tests: one paragraph of plain text. */
export const textOf = (text: string): RichText => ({ paragraphs: [{ kind: 'p', runs: [{ t: text }] }] });
