/**
 * Root ESLint config (flat, ESLint 9).
 *
 * Scope: lint rules that catch bugs — not style ones (Prettier owns
 * formatting). The explicit goal is "zero bikeshed, catch real smells":
 * - vue/essential + vue/strongly-recommended
 * - typescript-eslint recommended
 * - prettier runs last to disable conflicting style rules
 *
 * Deliberately NOT enabled:
 *   - vue/multi-word-component-names (we have Dashboard, Settings etc.
 *     as single-word views; renaming them would be churn with no bug payoff).
 *   - @typescript-eslint/no-explicit-any (there are legit any's in
 *     mock-heavy test files and the api-client's generic envelopes; we
 *     prefer typed-at-boundaries, pragmatic within).
 */
import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueTsEslintConfig from '@vue/eslint-config-typescript'
import prettierSkipFormatting from '@vue/eslint-config-prettier/skip-formatting'

export default [
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,tsx,vue}'],
  },

  {
    name: 'app/files-to-ignore',
    ignores: [
      '**/dist/**',
      '**/.nuxt/**',
      '**/.output/**',
      '**/.wrangler/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/public/**',
    ],
  },

  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  ...vueTsEslintConfig(),
  prettierSkipFormatting,

  {
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    // Tests + setup files run under vitest globals and can be looser.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
]
