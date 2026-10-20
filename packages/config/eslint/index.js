// Shared ESLint flat config for every workspace package.
// Usage in a package: `export { default } from '@blokum/config/eslint';`
// or `import { createConfig } from '@blokum/config/eslint'; export default createConfig({ react: true });`
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * @param {{ react?: boolean, ignores?: string[] }} [options]
 */
export function createConfig(options = {}) {
  const { react = false, ignores = [] } = options;
  return tseslint.config(
    {
      ignores: ['dist/**', '.next/**', 'coverage/**', 'node_modules/**', 'next-env.d.ts', '*.config.js', ...ignores],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node, ...(react ? globals.browser : {}) },
        parserOptions: { projectService: true },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/no-floating-promises': 'error',
        'no-console': ['error', { allow: ['warn', 'error'] }],
        eqeqeq: ['error', 'always'],
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/test/**'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      ...tseslint.configs.disableTypeChecked,
    },
    ...(react
      ? [
          {
            files: ['**/*.tsx'],
            plugins: { 'react-hooks': reactHooks },
            rules: {
              'react-hooks/rules-of-hooks': 'error',
              'react-hooks/exhaustive-deps': 'error',
            },
          },
        ]
      : []),
  );
}

export default createConfig();
