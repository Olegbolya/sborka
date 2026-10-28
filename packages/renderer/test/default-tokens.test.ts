import { expect, test } from 'vitest';
import { DEFAULT_RENDER_TOKENS, DEV_THEMES } from '../src/index.js';

test('PL-19: тема по умолчанию записана готовым значением и равна разобранной служебной светлой теме', () => {
  expect(DEFAULT_RENDER_TOKENS).toEqual(DEV_THEMES.light);
});
