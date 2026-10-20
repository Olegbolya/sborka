import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createVitestConfig } from '../vitest/index.js';

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as {
  extends?: string;
  compilerOptions: Record<string, unknown>;
};

describe('общие настройки', () => {
  it('базовый tsconfig включает строгие проверки, которые нельзя ослаблять', () => {
    const base = read('../tsconfig/base.json');
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
  });

  it('все tsconfig наследуют базовый', () => {
    for (const name of ['node-lib', 'react-lib', 'nextjs']) {
      expect(read(`../tsconfig/${name}.json`).extends).toBe('./base.json');
    }
    expect(read('../tsconfig/nest.json').extends).toBe('./node-lib.json');
  });

  it('порог покрытия по умолчанию — 80 %', () => {
    const cfg = createVitestConfig({ coverage: true });
    const thresholds = cfg.test?.coverage && 'thresholds' in cfg.test.coverage ? cfg.test.coverage.thresholds : undefined;
    expect(thresholds).toMatchObject({ lines: 80, statements: 80, functions: 80 });
  });

  it('без покрытия пакет не требует порогов, но пустой набор тестов — ошибка', () => {
    const cfg = createVitestConfig();
    expect(cfg.test?.coverage?.enabled).toBe(false);
    expect(cfg.test?.passWithNoTests).toBe(false);
  });
});
