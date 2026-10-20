#!/usr/bin/env node
// One render (CLAUDE.md, docs/02-ARCHITECTURE.md §2): how blocks look is described ONLY in packages/renderer.
// apps/web may use @blokum/renderer, but must not draw blocks itself. The lesson of BST: two copies of
// block markup drift apart. Required by the acceptance of P1.4 (docs/03-PLAN.md).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { ROOT } from './lib/plan.mjs';

const SCAN = ['apps/web'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo']);

/** [rule, regex] — each match is a violation. */
export const RULES = [
  ['внутренние классы рендера (bk-block, bk-surface…) в разметке', /className\s*=\s*[{'"`]*[^\n]*\bbk-(block|surface|content|text|fill|screen|screen-bg|artboard|stage)\b/],
  ['свой компонент блока или экрана', /\b(function|const|class)\s+\w*(Block|Screen)(View|Renderer|Render|Preview|Node|Component)\b/],
  ['перевод стиля блока в CSS вне рендера', /\b(borderRadius|boxShadow|backgroundImage|WebkitTextStroke|mixBlendMode|backdropFilter|textShadow|clipPath)\s*:\s*[^,}\n]*\b(style|fills?|shadows?|radius|effects|stroke|mask)\b/],
  ['импорт внутренностей рендера', /from\s+['"](@blokum\/renderer\/(src|dist)\/|(\.\.\/)+packages\/renderer)/],
];

export function violations(text) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    for (const [rule, re] of RULES) if (re.test(line)) found.push({ line: i + 1, rule, text: line.trim().slice(0, 120) });
  });
  return found;
}

// Self-test on every run: the rules must keep catching what they are meant to catch.
const SHOULD_FAIL = [
  `<div className="bk-block" />`,
  `<div className={'bk-surface'}>`,
  `export function MyBlockView() {}`,
  `const ScreenPreview = () => null;`,
  `style={{ borderRadius: block.style.radius.tl }}`,
  `const css = { boxShadow: shadows.map(f).join() };`,
  `import { styleToCss } from '@blokum/renderer/src/style/style-to-css.js';`,
];
const SHOULD_PASS = [
  `import { Artboard, ScreenView, BlockView } from '@blokum/renderer';`,
  `<ScreenView screen={screen} />`,
  `<div className="editor-panel" style={{ borderRadius: 8 }} />`,
  `onChange={(v) => setBlock({ ...block, style: { ...block.style, radius: v } })}`,
];
for (const s of SHOULD_FAIL) if (violations(s).length === 0) throw new Error(`check-render-boundary: правило не поймало «${s}»`);
for (const s of SHOULD_PASS) if (violations(s).length > 0) throw new Error(`check-render-boundary: ложное срабатывание на «${s}»`);

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(name)) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
}

const files = [];
for (const d of SCAN) walk(join(ROOT, d), files);
const problems = files.flatMap((f) => violations(readFileSync(f, 'utf8')).map((v) => ({ ...v, file: relative(ROOT, f) })));
if (problems.length) {
  console.error('check-render-boundary: вид блоков описывается только в packages/renderer:');
  for (const p of problems) console.error(`  ${p.file}:${p.line} — ${p.rule}: ${p.text}`);
  process.exit(1);
}
console.log(`check-render-boundary: ок (${files.length} файлов)`);
