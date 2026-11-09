import swc from 'unplugin-swc';
import { createVitestConfig } from '@blokum/config/vitest';

// SWC keeps decorator metadata that NestJS dependency injection needs (esbuild drops it).
// Coverage requires a live PostgreSQL (all integration tests skip without it, dropping coverage to ~0%).
// CI always sets DATABASE_URL; local Windows dev without PostgreSQL skips coverage automatically.
const pgAvailable = !!process.env.DATABASE_URL;
export default createVitestConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  coverage: pgAvailable ? { include: ['src/**/*.ts'], exclude: ['src/main.ts'] } : false,
});
