// Copies browser files of libraries into public/vendor, so the site never loads them from a foreign CDN
// (CLAUDE.md: only Russian external services). Run before `next build` and `next dev`.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fromRenderer = createRequire(join(here, '../../../packages/renderer/package.json'));
const lottieDist = dirname(fromRenderer.resolve('@lottiefiles/dotlottie-web'));
const lottieVersion = JSON.parse(readFileSync(join(lottieDist, '../package.json'), 'utf8')).version;

// The renderer asks for exactly this file (LOTTIE_WASM_URL); a different installed version fails the build.
const expected = readFileSync(join(here, '../../../packages/renderer/src/media/lottie.ts'), 'utf8').match(/dotlottie-player-([\d.]+)\.wasm/)?.[1];
if (expected !== lottieVersion) {
  console.error(`copy-vendor: рендер ждёт dotlottie-web ${expected}, установлена ${lottieVersion} — обновите LOTTIE_WASM_URL`);
  process.exit(1);
}

const out = join(here, '../public/vendor');
mkdirSync(out, { recursive: true });
copyFileSync(join(lottieDist, 'dotlottie-player.wasm'), join(out, `dotlottie-player-${lottieVersion}.wasm`));
process.stdout.write(`copy-vendor: dotlottie-player-${lottieVersion}.wasm\n`);
