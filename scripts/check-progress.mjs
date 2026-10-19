#!/usr/bin/env node
// Keeps docs/PROGRESS.md honest:
//  - every task of docs/03-PLAN.md has exactly one row;
//  - a task marked ✅ has a commit hash, evidence and a traceability row for EVERY requirement it covers,
//    whose test file exists and mentions the requirement ID;
//  - a task marked ⛔ says why;
//  - every requirement defined in the specs (except v2) is covered by some task of the plan.
// Usage: node scripts/check-progress.mjs [--summary]
import { execFileSync } from 'node:child_process';
import { parsePlan, parseProgress, parseTraceability, definedRequirementIds, exists, read, STATUSES } from './lib/plan.mjs';

const summaryOnly = process.argv.includes('--summary');
const errors = [];
const warnings = [];

const plan = parsePlan();
const progress = parseProgress();
const trace = parseTraceability();
const planIds = new Set(plan.map((t) => t.id));

// 1. Plan ↔ progress rows
const seen = new Map();
for (const row of progress) {
  if (seen.has(row.id)) errors.push(`${row.id}: строка задачи встречается в PROGRESS.md дважды`);
  seen.set(row.id, row);
  if (!planIds.has(row.id)) errors.push(`${row.id}: есть в PROGRESS.md, но нет в 03-PLAN.md`);
}
for (const task of plan) if (!seen.has(task.id)) errors.push(`${task.id}: задачи нет в PROGRESS.md — добавь строку`);

// 2. Row contents
let gitOk = true;
const commitExists = (sha) => {
  if (!gitOk) return true;
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
} catch {
  gitOk = false;
}

for (const task of plan) {
  const row = seen.get(task.id);
  if (!row) continue;
  if (!STATUSES.includes(row.status)) {
    errors.push(`${task.id}: неизвестный статус «${row.status}» (допустимы ${STATUSES.join(' ')})`);
    continue;
  }
  if (row.status === '⛔' && row.evidence.length < 10) errors.push(`${task.id}: ⛔ без причины блокировки`);
  if (row.status !== '✅') continue;

  const shas = row.commit.split(/[\s,]+/).filter(Boolean);
  if (shas.length === 0 || !shas.every((s) => /^[0-9a-f]{7,40}$/.test(s))) {
    errors.push(`${task.id}: ✅ без хэша коммита (колонка «Коммит»)`);
  } else {
    for (const s of shas) if (!commitExists(s)) warnings.push(`${task.id}: коммит ${s} не найден в локальной истории (неполный клон?)`);
  }
  if (row.evidence.length < 20) errors.push(`${task.id}: ✅ без доказательства (какие проверки запускались и с каким итогом)`);

  for (const req of task.covers) {
    const rows = trace.filter((r) => r.req === req && r.task === task.id);
    if (rows.length === 0) {
      errors.push(`${task.id}: нет строки трассировки для ${req} в docs/TRACEABILITY.md`);
      continue;
    }
    for (const r of rows) {
      const tests = r.test.split(/[,;]\s*/).filter(Boolean);
      const codes = r.code.split(/[,;]\s*/).filter(Boolean);
      if (tests.length === 0) errors.push(`${task.id}/${req}: не указан файл теста`);
      for (const t of tests) {
        const path = t.replace(/#.*$/, '');
        if (!exists(path)) errors.push(`${task.id}/${req}: файл теста ${path} не существует`);
        else if (!read(path).includes(req)) errors.push(`${task.id}/${req}: в ${path} нет теста с «${req}» в названии`);
      }
      for (const c of codes) {
        const path = c.replace(/#.*$/, '');
        if (!exists(path)) errors.push(`${task.id}/${req}: файл кода ${path} не существует`);
      }
    }
  }
}

// 3. Every non-v2 requirement is covered by the plan
const covered = new Set(plan.flatMap((t) => t.covers));
for (const [id, info] of definedRequirementIds()) {
  if (info.v2) continue;
  if (!covered.has(id)) errors.push(`${id} (${info.file}) не покрыт ни одной задачей плана`);
}

// Summary
const count = (s) => progress.filter((r) => r.status === s).length;
const next = plan.find((t) => seen.get(t.id)?.status === '🟨') ?? plan.find((t) => seen.get(t.id)?.status === '⬜');
const summary = [
  `Задач: ${plan.length} · ✅ ${count('✅')} · 🟨 ${count('🟨')} · ⬜ ${count('⬜')} · ⛔ ${count('⛔')}`,
  next ? `Следующая задача: ${next.id} · ${next.title}${next.opus ? ' (рекомендуется Opus high)' : ''}` : 'Все задачи плана закрыты или заблокированы.',
];
const blocked = plan.filter((t) => seen.get(t.id)?.status === '⛔').map((t) => `${t.id} — ${seen.get(t.id).evidence}`);
if (blocked.length) summary.push(`Заблокировано: ${blocked.join('; ')}`);

if (summaryOnly) {
  console.log(summary.join('\n'));
  process.exit(0);
}
for (const w of warnings) console.warn(`предупреждение: ${w}`);
if (errors.length) {
  console.error(`check-progress: ${errors.length} ошибок\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`check-progress: ок\n${summary.join('\n')}`);
