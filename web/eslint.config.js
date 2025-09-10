// @ts-check
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        // No type-aware linting needed for hooks rules
        project: null,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]

