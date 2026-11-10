import { foldChars, textForms } from './normalize.js';

/** A word or phrase of a dictionary. A word is a stem: «парол» finds «пароль», «пароля», «паролем». */
export interface TermSpec {
  id: string;
  text: string;
  /** Short words («пин», «cvv») that would be found inside other words: only the word itself and its case endings count. */
  exact?: boolean;
}

export interface CompiledTerm {
  spec: TermSpec;
  stems: string[];
}

const ENDINGS = ['', 'а', 'у', 'е', 'ы', 'и', 'ом', 'ов', 'ам', 'ах', 'ами', 'ем', 'ю', 'я', 'ь'];

export function compileTerms(specs: readonly TermSpec[]): CompiledTerm[] {
  const out: CompiledTerm[] = [];
  for (const spec of specs) {
    const stems = foldChars(spec.text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter((s) => s !== '');
    if (stems.length > 0) out.push({ spec, stems });
  }
  return out;
}

function tokenMatches(token: string, stem: string, exact: boolean): boolean {
  if (!token.startsWith(stem)) return false;
  return exact ? ENDINGS.includes(token.slice(stem.length)) : true;
}

function phraseIn(words: readonly string[], term: CompiledTerm): boolean {
  const n = term.stems.length;
  for (let i = 0; i + n <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      if (!tokenMatches(words[i + j]!, term.stems[j]!, term.spec.exact === true)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** The terms of the dictionary that the text contains, each once. */
export function findTerms(text: string, terms: readonly CompiledTerm[]): TermSpec[] {
  if (text.trim() === '') return [];
  const forms = textForms(text);
  const found: TermSpec[] = [];
  for (const t of terms) {
    if (phraseIn(forms.words, t) || phraseIn(forms.glued, t) || phraseIn(forms.squeezed, t)) found.push(t.spec);
  }
  return found;
}
