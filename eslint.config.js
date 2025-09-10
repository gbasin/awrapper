// @ts-check
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactHooks from 'eslint-plugin-react-hooks'

// Root ESLint flat config to lint the entire repo, including web
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'coverage/**',
      'web/test-results/**',
      '.awrapper-worktrees/**',
    ],
  },
  // Base TypeScript parsing for all TS/TSX files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // Keep type-aware linting off for speed and simplicity
        project: null,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
  },
  // React Hooks rules for the web app only
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
