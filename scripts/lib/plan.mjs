// Shared parsers for the plan, progress tracker and traceability table.
// No dependencies: runs on plain Node 22 before the monorepo exists.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
export const exists = (rel) => existsSync(join(ROOT, rel));

// Requirement IDs look like B-11, PL-06, TS-10, TPL-03, SC-02. Multi-letter prefixes before single letters.
const PREFIX = '(?:TPL|TH|PL|AD|TS|SR|SC|TR|CN|AC|BH|VR|RN|RG|ME|LB|GS|[EBSLTPQDAN])';
const ID_RE = new RegExp(`\\b(${PREFIX})-(\\d{2})\\b`, 'g');
const RANGE_RE = new RegExp(`\\b(${PREFIX})-(\\d{2})\\s*(?:…|\\.\\.\\.)\\s*(${PREFIX})-(\\d{2})\\b`, 'g');

/** Returns requirement IDs mentioned in text; ranges like S-01…S-17 are expanded. */
export function extractIds(text) {
  const ids = new Set();
  const withoutRanges = text.replace(RANGE_RE, (_m, p1, a, p2, b) => {
    if (p1 !== p2) throw new Error(`Диапазон с разными префиксами: ${_m}`);
    const from = Number(a);
    const to = Number(b);
    if (to < from) throw new Error(`Обратный диапазон: ${_m}`);
    for (let n = from; n <= to; n++) ids.add(`${p1}-${String(n).padStart(2, '0')}`);
    return ' ';
  });
  for (const m of withoutRanges.matchAll(ID_RE)) ids.add(`${m[1]}-${m[2]}`);
  return [...ids];
}

/** Parses docs/03-PLAN.md into tasks: { id, title, opus, covers, hasAcceptance }. */
export function parsePlan(text = read('docs/03-PLAN.md')) {
  const tasks = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  let phaseOpus = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) phaseOpus = /\[OPUS\]/.test(line);
    const h = line.match(/^###\s+(P\d+\.\d+)\s+·\s+(.+?)\s*$/);
    if (h) {
      current = {
        id: h[1],
        title: h[2].replace(/\s*\[OPUS[^\]]*\]\s*/g, ' ').trim(),
        opus: phaseOpus || /\[OPUS/.test(h[2]),
        covers: [],
        hasAcceptance: false,
      };
      tasks.push(current);
      continue;
    }
    if (/^##\s/.test(line)) current = null;
    if (!current) continue;
    const cov = line.match(/^\*\*Покрывает:\*\*\s*(.+)$/);
    if (cov) current.covers.push(...extractIds(cov[1]));
    if (/^\*\*Приёмка/.test(line)) current.hasAcceptance = true;
  }
  return tasks;
}

export const STATUSES = ['⬜', '🟨', '✅', '⛔'];

/** Parses the task table in docs/PROGRESS.md: | ID | Задача | Статус | Коммит | Доказательство / заметки | */
export function parseProgress(text = read('docs/PROGRESS.md')) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(P\d+\.\d+)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    rows.push({ id: m[1], title: cells[0] ?? '', status: cells[1] ?? '', commit: cells[2] ?? '', evidence: cells[3] ?? '' });
  }
  return rows;
}

/** Parses docs/TRACEABILITY.md rows: | ID | задача | файл кода | файл теста | */
export function parseTraceability(text = exists('docs/TRACEABILITY.md') ? read('docs/TRACEABILITY.md') : '') {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*([A-Z]{1,3}-\d{2})\s*\|\s*(P\d+\.\d+)\s*\|([^|]*)\|([^|]*)\|/);
    if (!m) continue;
    rows.push({ req: m[1], task: m[2], code: m[3].trim().replace(/`/g, ''), test: m[4].trim().replace(/`/g, '') });
  }
  return rows;
}

/** Requirement IDs defined in the specs (excluding ones marked as v2). */
export function definedRequirementIds() {
  const files = ['docs/01-PRODUCT-SPEC.md', 'docs/06-TRUST-SAFETY.md'];
  const defined = new Map();
  for (const f of files) {
    for (const line of read(f).split('\n')) {
      const isV2 = /`v2`|\bv2\b/.test(line);
      // A definition is a backticked ID at the start of a bullet, numbered item, heading or table cell, or after «·».
      for (const m of line.matchAll(new RegExp(`(?:^\\s*(?:[-*]|\\d+\\.|#+)\\s*|\\|\\s*|·\\s*|^)\`(${PREFIX}-\\d{2})\``, 'g'))) {
        if (!defined.has(m[1])) defined.set(m[1], { file: f, v2: isV2 });
      }
    }
  }
  return defined;
}
