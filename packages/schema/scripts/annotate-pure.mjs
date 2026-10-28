// P5.7 (PL-19, ADR-048): объявления схем (`const X = z.object(...)`) бандлер считает действиями с побочным эффектом и
// не выбрасывает, даже если схема не нужна плееру. Знак /*#__PURE__*/ говорит: вызов можно убрать, если результат не нужен.
// Скрипт идёт после tsc и размечает только объявления верхнего уровня, собранные из `z.` и других схем.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const declaration = /^((?:export )?const [A-Za-z_$][\w$]* = )((?:z|[A-Z][\w$]*)(?=\s*\.))/gm;
let marked = 0;
for (const name of readdirSync(dist).filter((f) => f.endsWith('.js'))) {
  const file = dist + name;
  const text = readFileSync(file, 'utf8');
  const next = text.replace(declaration, (_m, head, start) => {
    marked += 1;
    return `${head}/*#__PURE__*/ ${start}`;
  });
  if (next !== text) writeFileSync(file, next);
}
process.stdout.write(`schema: размечено объявлений схем — ${marked}\n`);
