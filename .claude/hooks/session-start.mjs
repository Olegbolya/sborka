#!/usr/bin/env node
// Claude Code SessionStart hook: prints the current state of work into the agent's context
// and remembers HEAD so the Stop hook can tell whether this session made commits.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let input = {};
try {
  const raw = readFileSync(0, 'utf8');
  input = raw.trim() ? JSON.parse(raw) : {};
} catch {
  input = {};
}
const sid = String(input.session_id || 'default').replace(/[^\w-]/g, '');
try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  writeFileSync(join(tmpdir(), `blokum-start-${sid}.txt`), head);
} catch {
  /* no commits yet */
}

const summary = spawnSync('node', ['scripts/check-progress.mjs', '--summary'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || 'Сводка недоступна — прочитай docs/PROGRESS.md.';
process.stdout.write(
  [
    '«Блокум»: состояние работы',
    summary,
    '',
    'Порядок: прочитай docs/PROGRESS.md → задачу в docs/03-PLAN.md → требования из «Покрывает» → делай без согласования плана.',
    'Помни: без заглушек и упрощений; тесты с ID требований; pnpm verify; скриншоты смотри сам; коммит + push + CI; PROGRESS и TRACEABILITY; затем следующая задача.',
    'Итог сессии — по шаблону из CLAUDE.md (раздел «Не сделано» обязателен).',
  ].join('\n') + '\n',
);
