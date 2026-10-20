import { defineConfig } from 'vitest/config';

// SC-05 benchmark runs alone (a separate step of `pnpm verify`), without coverage instrumentation and
// without other test suites competing for the CPU — otherwise it measures the load, not the engine.
export default defineConfig({
  test: { include: ['test/runtime.bench.ts'], fileParallelism: false, coverage: { enabled: false } },
});
