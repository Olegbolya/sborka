// Shared Vitest settings. Coverage thresholds are mandatory for schema, engine and API domain
// services (docs/03-PLAN.md, DoD п. 4); other packages pass `coverage: false`.
import { defineConfig } from 'vitest/config';

/**
 * @param {{ environment?: 'node' | 'jsdom', coverage?: boolean | { include?: string[], exclude?: string[], thresholds?: number }, setupFiles?: string[], plugins?: import('vitest/config').UserConfig['plugins'] }} [options]
 */
export function createVitestConfig(options = {}) {
  const { environment = 'node', coverage = false, setupFiles = [], plugins = [] } = options;
  const cov = typeof coverage === 'object' ? coverage : {};
  const threshold = cov.thresholds ?? 80;
  return defineConfig({
    plugins,
    // Vite 8 transforms TS/TSX with Oxc; JSX always uses the automatic React runtime
    // (tsconfig of Next.js sets `jsx: preserve`, which must not leak into tests).
    oxc: { jsx: { runtime: 'automatic' } },
    test: {
      environment,
      setupFiles,
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
      passWithNoTests: false,
      coverage: coverage
        ? {
            enabled: true,
            provider: 'v8',
            include: cov.include ?? ['src/**/*.{ts,tsx}'],
            exclude: [...(cov.exclude ?? []), '**/*.test.{ts,tsx}', '**/index.ts', '**/*.d.ts'],
            reporter: ['text-summary', 'json-summary'],
            thresholds: { lines: threshold, statements: threshold, functions: threshold, branches: Math.min(threshold, 75) },
          }
        : { enabled: false },
    },
  });
}

export default createVitestConfig();
