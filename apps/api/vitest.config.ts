import swc from 'unplugin-swc';
import { createVitestConfig } from '@blokum/config/vitest';

// SWC keeps decorator metadata that NestJS dependency injection needs (esbuild drops it).
export default createVitestConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  coverage: { include: ['src/**/*.ts'], exclude: ['src/main.ts'] },
});
