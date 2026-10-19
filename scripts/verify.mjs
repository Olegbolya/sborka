#!/usr/bin/env node
// Single entry point for all checks: `pnpm verify` → turbo (lint, typecheck, test) + repository checks.
// Flags: --fast (skip turbo — used by the Stop hook when no code changed), --with-e2e (also run `pnpm e2e`).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/plan.mjs';

const fast = process.argv.includes('--fast');
const withE2e = process.argv.includes('--with-e2e');
const steps = [];

const pkgPath = join(ROOT, 'package.json');
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
if (pkg && !fast) {
  steps.push(['pnpm', ['-s', 'turbo', 'run', 'lint', 'typecheck', 'test', '--output-logs=errors-only']]);
}
steps.push(
  ['node', ['scripts/check-forbidden.mjs']],
  ['node', ['scripts/check-foreign-services.mjs']],
  ['node', ['scripts/check-licenses.mjs']],
  ['node', ['scripts/check-legal.mjs']],
  ['node', ['scripts/check-progress.mjs']],
);
if (withE2e && pkg?.scripts?.e2e) steps.push(['pnpm', ['-s', 'e2e']]);

const failed = [];
for (const [cmd, args] of steps) {
  const label = `${cmd} ${args.join(' ')}`;
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) failed.push(label);
}

console.log('\n' + '─'.repeat(60));
if (failed.length) {
  console.error(`verify: НЕ ПРОЙДЕНО (${failed.length}):\n- ${failed.join('\n- ')}`);
  process.exit(1);
}
console.log(`verify: всё зелёное (${steps.length} шагов)`);
