#!/usr/bin/env node
// Claude Code Stop hook: refuses to let the agent stop while the work is visibly unfinished.
// Blocks (at most 3 times in a row, then lets go) when:
//   - changed files contain stubs/TODO/skipped tests (check-forbidden --changed);
//   - code changed and `node scripts/verify.mjs` fails (result cached per diff, so it runs once per change);
//   - docs/PROGRESS.md is inconsistent (check-progress);
//   - there are uncommitted or unpushed changes;
//   - commits were made this session but the final message lacks the report template from CLAUDE.md.
// Any internal error → allow stopping (the hook must never trap the agent because of its own bug).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_CONSECUTIVE_BLOCKS = 3;
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function readInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 840_000 });
const tail = (s, n = 2500) => (s.length > n ? '…' + s.slice(-n) : s);

try {
  const input = readInput();
  const sid = String(input.session_id || 'default').replace(/[^\w-]/g, '');
  const stateFile = join(tmpdir(), `blokum-stop-${sid}.json`);
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { blocks: 0 };
  const save = () => writeFileSync(stateFile, JSON.stringify(state));

  if (state.blocks >= MAX_CONSECUTIVE_BLOCKS) {
    state.blocks = 0;
    save();
    process.stderr.write('stop-gate: 3 блокировки подряд — отпускаю. Незакрытые проблемы опиши в итоговом сообщении в разделе «Не сделано».\n');
    process.exit(0);
  }

  const reasons = [];
  try {
    git(['rev-parse', '--git-dir']);
  } catch {
    process.exit(0); // not a git checkout — nothing to check
  }

  // 1. Stubs in changed files
  const forbidden = run('node', ['scripts/check-forbidden.mjs', '--changed']);
  if (forbidden.status !== 0) reasons.push(`Запрещённые шаблоны в изменённых файлах:\n${tail(forbidden.stderr || forbidden.stdout)}`);

  // 2. Verify, cached by the exact working-tree diff
  const status = git(['status', '--porcelain']);
  const codeChanged = status.split('\n').some((l) => /^\s*\S+\s+"?(apps|packages|e2e|infra|scripts)\//.test(l));
  if (existsSync(join(root, 'package.json'))) {
    const diffHash = createHash('sha256').update(git(['rev-parse', 'HEAD'])).update(git(['diff', 'HEAD'])).update(status).digest('hex');
    if (state.verifiedHash !== diffHash) {
      const v = run('node', ['scripts/verify.mjs', ...(codeChanged ? [] : ['--fast'])]);
      if (v.status === 0) state.verifiedHash = diffHash;
      else reasons.push(`pnpm verify не проходит:\n${tail((v.stdout || '') + (v.stderr || ''))}`);
    }
  } else {
    const p = run('node', ['scripts/check-progress.mjs']);
    if (p.status !== 0) reasons.push(`docs/PROGRESS.md не согласован с планом:\n${tail(p.stderr || p.stdout)}`);
  }

  // 3. Uncommitted / unpushed work
  if (status) reasons.push(`Есть незакоммиченные изменения:\n${tail(status, 800)}\nЗакоммить (main должен оставаться зелёным) и запушь, либо откати.`);
  try {
    const ahead = git(['rev-list', '--count', '@{u}..HEAD']);
    if (Number(ahead) > 0) reasons.push(`Есть ${ahead} незапушенных коммитов — выполни git push и дождись CI.`);
  } catch {
    /* no upstream configured */
  }

  // 4. Report template after real work
  const startFile = join(tmpdir(), `blokum-start-${sid}.txt`);
  const startHead = existsSync(startFile) ? readFileSync(startFile, 'utf8').trim() : '';
  const head = git(['rev-parse', 'HEAD']);
  const msg = String(input.last_assistant_message || '');
  if (startHead && startHead !== head && msg && !/Не сделано/i.test(msg)) {
    reasons.push('В этой сессии были коммиты, но итоговое сообщение не по шаблону CLAUDE.md (правило 7): «Сделано / Не сделано / частично / Нужно от владельца / Следующий шаг». Раздел «Не сделано» обязателен.');
  }

  if (reasons.length) {
    state.blocks += 1;
    save();
    process.stdout.write(JSON.stringify({ decision: 'block', reason: `stop-gate (${state.blocks}/${MAX_CONSECUTIVE_BLOCKS}): работа не завершена.\n\n${reasons.join('\n\n')}` }));
    process.exit(0);
  }
  state.blocks = 0;
  save();
  process.exit(0);
} catch (e) {
  process.stderr.write(`stop-gate: внутренняя ошибка хука, остановка разрешена: ${e?.message ?? e}\n`);
  process.exit(0);
}
