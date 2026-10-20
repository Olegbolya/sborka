#!/usr/bin/env node
// Every bundled asset (fonts, stickers, reactions, sounds, backgrounds) must have a license record.
// See docs/05-LEGAL.md §2.10. Manifest: packages/themes/assets/LICENSES.json
//   { "files": { "<path relative to assets/>": { "license": "own|OFL-1.1|CC0-1.0|MIT|Apache-2.0|CC-BY-4.0",
//                                               "author": "...", "source": "url or 'создано для Блокума'", "attribution"?: "..." } } }
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './lib/plan.mjs';

const ASSETS = join(ROOT, 'packages', 'themes', 'assets');
const MANIFEST = join(ASSETS, 'LICENSES.json');
const ALLOWED = new Set(['own', 'OFL-1.1', 'CC0-1.0', 'MIT', 'Apache-2.0', 'CC-BY-4.0']);

if (!existsSync(ASSETS)) {
  console.log('check-licenses: каталога ассетов ещё нет — пропуск');
  process.exit(0);
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (full !== MANIFEST && !name.startsWith('.')) files.push(relative(ASSETS, full).split('\\').join('/'));
  }
})(ASSETS);

const problems = [];
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')).files ?? {} : {};
if (!existsSync(MANIFEST) && files.length) problems.push('нет packages/themes/assets/LICENSES.json');

for (const f of files) {
  const rec = manifest[f];
  if (!rec) {
    problems.push(`${f}: нет записи о лицензии`);
    continue;
  }
  if (!ALLOWED.has(rec.license)) problems.push(`${f}: лицензия «${rec.license}» не из разрешённого списка`);
  if (!rec.author || !rec.source) problems.push(`${f}: не указан автор или источник`);
  if (rec.license === 'CC-BY-4.0' && !rec.attribution) problems.push(`${f}: CC-BY требует поле attribution`);
}
for (const f of Object.keys(manifest)) if (!files.includes(f)) problems.push(`${f}: запись в манифесте есть, файла нет`);

if (problems.length) {
  console.error(`check-licenses: ${problems.length} проблем\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`check-licenses: ок (${files.length} файлов)`);
