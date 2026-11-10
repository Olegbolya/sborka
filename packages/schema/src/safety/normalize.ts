/**
 * P9.1 · TS-02…TS-04 · text normalization for the dictionaries.
 *
 * Someone who wants to hide «пароль» writes «пaроль» (a Latin «a»), «п а р о л ь», «п.а.р.о.л.ь» or «пар*оль». The dictionary words
 * and the checked text go through the same steps, so both sides look alike: case, «ё»/«е», accents, look-alike Latin letters
 * and digits, and separators between letters stop mattering.
 */

/** Latin (and a few symbols and digits) that look like Cyrillic letters. */
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
  '0': 'о', '3': 'з', '@': 'а', $: 'с',
};

const INVISIBLE = new RegExp('[\\u00ad\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\ufeff]', 'gu');

/** One character at a time: lower case, no accents («ё» → «е», «й» → «и»), look-alikes turned into Cyrillic. */
export function foldChars(text: string): string {
  const decomposed = text.normalize('NFKD').replace(INVISIBLE, '').replace(/\p{M}/gu, '').toLowerCase();
  let out = '';
  for (const ch of decomposed) out += LOOKALIKE[ch] ?? ch;
  return out;
}

/** The ways one text can be read; a match in any of them counts. */
export interface TextForms {
  /** Words as written: everything that is not a letter or a digit separates words. */
  words: string[];
  /** The same, with runs of single letters («п а р о л ь», «п.а.р.о.л.ь») glued into one word. */
  glued: string[];
  /** Punctuation inside a word removed («пар*оль», «па-роль») — the word stays one. */
  squeezed: string[];
}

const SEPARATORS = /[^\p{L}\p{N}]+/gu;
const INNER_PUNCTUATION = /(?<=[\p{L}\p{N}])[^\p{L}\p{N}\s]+(?=[\p{L}\p{N}])/gu;

const tokens = (s: string): string[] => s.replace(SEPARATORS, ' ').trim().split(' ').filter((w) => w !== '');

/** Runs of three or more single-character words become one word; «и в с» in plain prose stays as it is only when shorter. */
function glueSingles(words: string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const w of words) {
    if ([...w].length === 1) run.push(w);
    else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out;
}

export function textForms(text: string): TextForms {
  const folded = foldChars(text);
  const words = tokens(folded);
  return { words, glued: glueSingles(words), squeezed: glueSingles(tokens(folded.replace(INNER_PUNCTUATION, ''))) };
}
