import { type TextRun } from './text.js';

/** Text without marks; variables count as one character each. */
export function plainText(rt: { paragraphs: Array<{ runs: Array<{ t?: string } | TextRun> }> }): string {
  return rt.paragraphs.map((p) => p.runs.map((r) => ('t' in r && typeof r.t === 'string' ? r.t : '•')).join('')).join('\n');
}
