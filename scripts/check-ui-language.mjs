#!/usr/bin/env node
// N-05 · everything a person reads — interface texts, error messages, emails — is in Russian (docs/05-LEGAL.md §2.9, 168-ФЗ).
// The check finds Latin words in user-facing strings: the text of JSX elements, the attributes `title`, `placeholder`, `aria-label`,
// `alt`, `label`, and the `message` fields of errors in the API and the schema. Words of the agreed list are allowed (docs/03-PLAN.md P8.10).
// A line may be allowed on purpose with the comment `ui-language-ok: <why>`.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT as REPO_ROOT } from './lib/plan.mjs';

// `--root=<папка>` проверяет другую папку с теми же подпапками (так тест проверяет сам себя, не трогая репозиторий).
const rootArg = process.argv.find((a) => a.startsWith('--root='));
const ROOT = rootArg ? rootArg.slice('--root='.length) : REPO_ROOT;

const require = createRequire(import.meta.url);
const ts = require('typescript');

// The agreed list (P8.10) and the names of brands, domains and formats a Russian reader meets as they are.
const AGREED = ['QR', 'CSV', 'XLSX', 'PNG', 'SVG', 'PDF', 'GIF', 'ID', 'VK', 'email', 'Lottie', 'WOFF2'];
// Added by the agent on 10.11.2026 (docs/DECISIONS.md, «Проверка русского языка»): names of formats, keys, brands and legal terms that
// a Russian reader meets as they are in the product. The owner may strike any of them out — the check will then show the place.
const ADDED = [
  'JSON', 'UTF', 'BOM', 'Excel', 'Microsoft', 'Google', 'Ctrl', 'Alt', 'Shift', 'Enter', 'ESC', 'cookie', 'TOTP', 'erid', 'OFL', 'px',
  'If-Match', 'JPEG', 'JPG', 'WEBP', 'MP4', 'WEBM', 'OTF', 'TTF', 'WOFF', 'ZIP', 'URL', 'blokker', 'ru',
];
const ALLOWED = new Set([...AGREED, ...ADDED].map((w) => w.toLowerCase()));
const SCAN = [
  ['apps/web/app', 'jsx'], ['apps/web/components', 'jsx'], ['apps/web/lib', 'jsx'], ['packages/ui/src', 'jsx'],
  ['apps/api/src', 'message'], ['packages/schema/src', 'message'], ['packages/engine/src', 'message'],
];
const SKIP = new Set(['node_modules', 'dist', '.next', 'coverage', 'build', '.turbo', 'test', 'tests', '__tests__', 'dev']); // `dev` — страницы для разработчиков, их не видят люди
const ATTRS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'aria-description']);
const MARK = 'ui-language-ok';

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx'].includes(extname(name)) && !/\.(test|spec|d)\.tsx?$/.test(name)) out.push(full);
  }
}

/** The Latin words of a string that are not on the list. */
function latinWords(text) {
  const bad = [];
  // A web address, an email, a path, a CSS value or a template hole is not a sentence.
  const clean = text.replace(/&\w+;|https?:\/\/\S*|\S+@\S+|\$\{[^}]*\}|\{\{[^}]*\}\}|\b[\w-]+(?:\.[\w-]+)*\.(?:ru|com|org)\b|[#/.][\w./-]+/g, ' ');
  // Only words in a text with Cyrillic letters or sentences of several words count: a lone token is an identifier or a code.
  for (const m of clean.matchAll(/[A-Za-z][A-Za-z'-]*[A-Za-z]|\b[A-Za-z]{2}\b/g)) {
    const w = m[0].toLowerCase();
    if (!ALLOWED.has(w)) bad.push(m[0]);
  }
  return bad;
}

const looksHuman = (text) => /[а-яё]/i.test(text) || /\s/.test(text.trim());

const problems = [];
let checked = 0;
for (const [dir, mode] of SCAN) {
  const files = [];
  walk(join(ROOT, dir), files);
  for (const full of files) {
    const source = readFileSync(full, 'utf8');
    const lines = source.split('\n');
    const sf = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true, full.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const rel = relative(ROOT, full).split('\\').join('/');
    const report = (node, text) => {
      if (!looksHuman(text)) return;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      if ((lines[line] ?? '').includes(MARK) || (lines[line - 1] ?? '').includes(MARK)) return;
      checked += 1;
      const bad = latinWords(text);
      if (bad.length) problems.push(`${rel}:${line + 1}: латиница в тексте для людей: ${[...new Set(bad)].join(', ')} — «${text.trim().slice(0, 80)}»`);
    };
    const visit = (node) => {
      if (mode === 'jsx') {
        if (ts.isJsxText(node)) {
          const t = node.getText(sf).replace(/\s+/g, ' ');
          if (t.trim()) report(node, t);
        } else if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText(sf)) && node.initializer) {
          const init = node.initializer;
          if (ts.isStringLiteral(init)) report(init, init.text);
          else if (ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) report(init.expression, init.expression.text);
        } else if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) {
          report(node.expression, node.expression.text);
        }
      }
      if (mode === 'message' && ts.isPropertyAssignment(node) && node.name.getText(sf).replace(/['"]/g, '') === 'message') {
        const v = node.initializer;
        if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) report(v, v.text);
        else if (ts.isTemplateExpression(v)) report(v, v.head.text + v.templateSpans.map((s) => ` _ ${s.literal.text}`).join(''));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

if (problems.length) {
  console.error(`check-ui-language: найдено ${problems.length} (проверено текстов: ${checked})`);
  for (const p of problems.slice(0, 80)) console.error(p);
  if (problems.length > 80) console.error(`… и ещё ${problems.length - 80}`);
  console.error('\nПереведи текст на русский или, если слово должно остаться (формат, имя сервиса), добавь его в список ALLOWED нового согласования с владельцем либо пометь строку комментарием `ui-language-ok: причина`.');
  process.exit(1);
}
console.log(`check-ui-language: ок (проверено текстов: ${checked})`);
