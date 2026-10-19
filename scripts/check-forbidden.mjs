#!/usr/bin/env node
// Fails when code contains stubs, skipped tests, silenced checks or filler text.
// Usage: node scripts/check-forbidden.mjs [--changed]   (--changed: only files changed vs HEAD + untracked)
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib/plan.mjs';

const SCAN_DIRS = ['apps', 'packages', 'e2e', 'infra'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage', 'build', '.turbo', '__screenshots__', 'playwright-report', 'test-results']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.css', '.scss', '.html', '.sh', '.yml', '.yaml', '.prisma', '.sql', '.conf']);
const isTestFile = (p) => /\.(test|spec)\.[cm]?[tj]sx?$/.test(p) || /(^|\/)(test|tests|__tests__|e2e|fixtures)\//.test(p);

const RULES = [
  { re: /\b(?:TODO|FIXME|HACK)\b/, why: 'незавершённая работа (TODO/FIXME/HACK)' },
  { re: /not\s+(?:yet\s+)?implemented/i, why: '«not implemented» — заглушка вместо реализации' },
  { re: /\b(?:it|test|describe|suite)\.(?:skip|only|todo|fixme)\s*\(/, why: 'пропущенный/единственный тест' },
  { re: /\b(?:xit|xtest|xdescribe|fdescribe)\s*\(/, why: 'пропущенный/единственный тест' },
  { re: /@ts-(?:ignore|nocheck)\b/, why: 'подавление проверки TypeScript' },
  { re: /@ts-expect-error(?![ \t]+\S)/, why: '@ts-expect-error без пояснения' },
  { re: /eslint-disable(?:-next-line|-line)?(?![^\n]*--[ \t]*\S)/, why: 'eslint-disable без причины (формат: eslint-disable-next-line правило -- причина)' },
  { re: /lorem ipsum|dolor sit amet/i, why: 'текст-«рыба»' },
  { re: /\bplaceholder (?:text|content|data)\b/i, why: 'текст-заполнитель' },
  { re: /временн(?:ая|ое|ый|ую) (?:заглушк|реализаци|решени|костыл)/i, why: '«временная заглушка/реализация»' },
  { re: /упрощ[её]нн(?:ая|ую|ый|ое) (?:верси|реализаци|вариант)/i, why: '«упрощённая версия» вместо полной' },
  { re: /(?:доработать|реализовать|сделать|добавить) (?:позже|потом|в будущем)/i, why: '«сделать позже»' },
  { re: /пока не (?:реализ|поддерж|сделан)/i, why: '«пока не реализовано»' },
  { re: /\b(?:fake|dummy|mock) (?:data|response|implementation)\b/i, why: 'фиктивные данные в рабочем коде', prodOnly: true },
];

const allowlistPath = join(ROOT, 'scripts', 'forbidden-allowlist.json');
const allowlist = existsSync(allowlistPath) ? JSON.parse(readFileSync(allowlistPath, 'utf8')) : [];
const allowed = (file, line) => allowlist.some((a) => a.file === file && line.includes(a.contains));

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(extname(name)) && st.size < 2_000_000) out.push(full);
  }
}

let files = [];
if (process.argv.includes('--changed')) {
  try {
    const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    const changed = new Set([...run(['diff', '--name-only', 'HEAD']), ...run(['ls-files', '--others', '--exclude-standard'])]);
    files = [...changed]
      .filter((p) => SCAN_DIRS.some((d) => p.startsWith(`${d}/`)) && TEXT_EXT.has(extname(p)) && !p.split('/').some((s) => SKIP_DIRS.has(s)))
      .map((p) => join(ROOT, p))
      .filter((p) => existsSync(p));
  } catch {
    for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  }
} else {
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
}

const problems = [];
for (const full of files) {
  const rel = relative(ROOT, full).split('\\').join('/');
  const lines = readFileSync(full, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.prodOnly && isTestFile(rel)) continue;
      if (rule.re.test(line) && !allowed(rel, line)) problems.push(`${rel}:${i + 1}: ${rule.why}\n    ${line.trim().slice(0, 160)}`);
    }
  });
}

if (problems.length) {
  console.error(`check-forbidden: найдено ${problems.length}\n${problems.join('\n')}\n\nИсправь реализацию, а не проверку (см. CLAUDE.md, правила 1 и 3).`);
  process.exit(1);
}
console.log(`check-forbidden: ок (${files.length} файлов)`);
