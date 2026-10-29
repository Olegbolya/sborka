import { type ProjectDocument, type Variable, VariableName, createVariable } from '@blokum/schema';
import { type Recipe } from './commands';

/** P3.8 · VR-01…VR-04 · the variables of the assembly: their list, names, types, starting values and the mark «записывать в ответы». */
export type VariableType = Variable['type'];

export const nameProblem = (doc: ProjectDocument, name: string, exceptId?: string): string | null => {
  const clean = name.trim();
  if (!VariableName.safeParse(clean).success) return 'Имя — буквы, цифры и «_», начинается с буквы.';
  if (doc.variables.some((v) => v.name === clean && v.id !== exceptId)) return 'Переменная с таким именем уже есть.';
  return null;
};

export const initialFor = (type: VariableType): Variable['initial'] => (type === 'number' ? 0 : type === 'text' ? '' : type === 'bool' ? false : []);

export const addVariableOf =
  (name: string, type: VariableType, onCreated?: (id: string) => void): Recipe =>
  (doc) => {
    if (nameProblem(doc, name) || doc.variables.length >= 200) return;
    const v = createVariable(name.trim(), type, initialFor(type));
    doc.variables.push(v);
    onCreated?.(v.id);
  };

export const renameVariable =
  (id: string, name: string): Recipe =>
  (doc) => {
    const v = doc.variables.find((x) => x.id === id);
    if (v && !nameProblem(doc, name, id)) v.name = name.trim();
  };

/** A new type starts with the value of its type: a text «5» is not a number. */
export const setVariableType =
  (id: string, type: VariableType): Recipe =>
  (doc) => {
    const v = doc.variables.find((x) => x.id === id);
    if (!v || v.type === type) return;
    v.type = type;
    v.initial = initialFor(type);
  };

export const setVariableInitial =
  (id: string, initial: Variable['initial']): Recipe =>
  (doc) => {
    const v = doc.variables.find((x) => x.id === id);
    if (!v) return;
    const ok = (v.type === 'number' && typeof initial === 'number') || (v.type === 'text' && typeof initial === 'string') || (v.type === 'bool' && typeof initial === 'boolean') || (v.type === 'list' && Array.isArray(initial));
    if (ok) v.initial = initial;
  };

export const setVariableSave =
  (id: string, saveToAnswers: boolean): Recipe =>
  (doc) => {
    const v = doc.variables.find((x) => x.id === id);
    if (v) v.saveToAnswers = saveToAnswers;
  };

export const removeVariable =
  (id: string): Recipe =>
  (doc) => {
    const at = doc.variables.findIndex((x) => x.id === id);
    if (at >= 0) doc.variables.splice(at, 1);
  };

/** How many places of the document refer to the variable (rules, conditions, texts, blocks): what deleting it would break. */
export function variableUsage(doc: ProjectDocument, id: string): number {
  let count = 0;
  const walk = (value: unknown, key?: string): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
      return;
    }
    if (value === id && (key === 'variableId' || key === 'v')) count += 1;
  };
  walk({ screens: doc.screens, rules: doc.rules, results: doc.results });
  return count;
}

/** A list value as the text a person types: «1, два, 3». */
export const listToText = (list: ReadonlyArray<number | string>): string => list.join(', ');
export const textToList = (text: string): Array<number | string> =>
  text
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .slice(0, 500)
    .map((x) => (Number.isFinite(Number(x)) ? Number(x) : x.slice(0, 200)));
