/**
 * TPL-03 · Starter system templates. 14 documents shipped out of the box, as pure data
 * (ADR-012: templates are data, not code). They are loaded from JSON files next to this
 * module and exposed through `loadSystemTemplates()`; the API seeds them on startup
 * (apps/api/src/projects/system-templates.service.ts). The administrator can publish
 * more system templates from any project later (AD-11).
 *
 * The baseline set required by TPL-03 covers four everyday scenarios
 * («Письмо Деду Морозу», «Викторина с баллами», «Анонимный опрос», «Приглашение с ответом»)
 * and the ten reference games RG-01…RG-10 from P3.12.
 *
 * No external assets, so `check-licenses` stays green and nothing is pulled from stock
 * or meme sites (docs/05-LEGAL.md §2.10).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { ProjectDocument, type ProjectDocument as ProjectDocumentT } from '@blokum/schema';

export interface SystemTemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly sort: number;
  readonly document: ProjectDocumentT;
}

interface TemplateSource {
  readonly id: string;
  readonly category: string;
  readonly sort: number;
  readonly file: string;
}

const CORE_SOURCES: ReadonlyArray<TemplateSource> = [
  { id: 'sys-tpl-letter-ded-moroz', category: 'Общее', sort: 10, file: '../templates/letter-ded-moroz.json' },
  { id: 'sys-tpl-quiz-with-score', category: 'Общее', sort: 20, file: '../templates/quiz-with-score.json' },
  { id: 'sys-tpl-anonymous-poll', category: 'Общее', sort: 30, file: '../templates/anonymous-poll.json' },
  { id: 'sys-tpl-rsvp-invite', category: 'Общее', sort: 40, file: '../templates/rsvp-invite.json' },
];

const REFERENCE_GAME_SOURCES: ReadonlyArray<TemplateSource> = Array.from({ length: 10 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return { id: `sys-tpl-rg${n}`, category: 'Игры', sort: 100 + i * 10, file: `../examples/rg-${n}.json` };
});

const ALL_SOURCES: ReadonlyArray<TemplateSource> = [...CORE_SOURCES, ...REFERENCE_GAME_SOURCES];

/** Returns stable id → source file (relative to this module) for every system template. */
export const SYSTEM_TEMPLATE_IDS: ReadonlyArray<string> = ALL_SOURCES.map((s) => s.id);

/** Reads the shipped JSON files, parses them against `ProjectDocument` and returns the definitions. */
export function loadSystemTemplates(): SystemTemplateDefinition[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return ALL_SOURCES.map(({ id, category, sort, file }) => {
    const path = resolve(here, file);
    const raw = readFileSync(path, 'utf8');
    const parsed = ProjectDocument.parse(JSON.parse(raw));
    return { id, name: parsed.meta.title, category, sort, document: parsed };
  });
}
