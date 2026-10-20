import { SCHEMA_VERSION } from './ids.js';
import { type ProjectDocument, ProjectDocument as DocumentSchema } from './document.js';

type Json = Record<string, unknown>;
/** Converts a document of version N into version N+1. */
export type Migration = (doc: Json) => Json;

/**
 * Registry of document migrations: key = version the migration starts from.
 * Rule: a change of the document schema adds a migration and a fixture in test/fixtures (docs/02-ARCHITECTURE.md §4 п. 4).
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // 0 → 1: pre-release drafts had no `schemaVersion` and screens without `blocks`.
  0: (doc) => ({
    ...doc,
    schemaVersion: 1,
    screens: (Array.isArray(doc.screens) ? doc.screens : []).map((s: Json) => ({ ...s, blocks: Array.isArray(s.blocks) ? s.blocks : [] })),
  }),
};

/** Brings a stored document up to the current version and validates it. */
export function migrateDocument(
  raw: unknown,
  registry: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): ProjectDocument {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TypeError('Документ сборки должен быть объектом');
  let doc = raw as Json;
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 0;
  if (version > target) throw new RangeError(`Сборка создана в более новой версии редактора (${version}); обновите страницу`);
  while (version < target) {
    const step = registry[version];
    if (!step) throw new RangeError(`Нет миграции документа с версии ${version}`);
    doc = step(doc);
    version += 1;
    doc = { ...doc, schemaVersion: version };
  }
  return DocumentSchema.parse(doc);
}
