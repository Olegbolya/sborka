#!/usr/bin/env node
// Reports unfilled {{PLACEHOLDERS}} in legal documents. With --strict (launch checklist) fails if any
// public document is missing or still contains placeholders. See docs/05-LEGAL.md §3.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/plan.mjs';

const strict = process.argv.includes('--strict');
const LEGAL = join(ROOT, 'legal');
const REQUIRED = [
  'terms.md', 'offer.md', 'privacy.md', 'pd-consent.md', 'participant-consent-template.md', 'dpa.md',
  'content-rules.md', 'cookies.md', 'marketing.md', 'complaints.md', 'contacts.md', 'participant-notice.md',
];
// Placeholders that are filled per creator at runtime (participant consent template) are allowed.
const RUNTIME = /\{\{(?:СОЗДАТЕЛЬ|СБОРКА|УЧАСТНИК)_[A-ZА-Я_]+\}\}/g;

const problems = [];
const found = existsSync(LEGAL) ? readdirSync(LEGAL).filter((f) => f.endsWith('.md')) : [];
if (strict) for (const r of REQUIRED) if (!found.includes(r)) problems.push(`нет документа legal/${r}`);

let total = 0;
for (const f of found) {
  const text = readFileSync(join(LEGAL, f), 'utf8').replace(RUNTIME, '');
  const ph = [...new Set(text.match(/\{\{[^}]+\}\}/g) ?? [])];
  total += ph.length;
  if (ph.length) problems.push(`legal/${f}: не заполнено ${ph.join(', ')}`);
}

if (!found.length) {
  console.log('check-legal: документов ещё нет (появятся в фазе 8)');
  process.exit(strict ? 1 : 0);
}
if (problems.length && strict) {
  console.error(`check-legal --strict: ${problems.length} проблем\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
if (problems.length) console.log(`check-legal: документы ещё не готовы к публикации (${total} подстановок) — это нормально до чек-листа запуска`);
else console.log('check-legal: ок');
