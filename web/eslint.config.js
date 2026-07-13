// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Import patterns banned inside `src/core` (ADR-0001): the domain layer knows nothing about
 * React, the DOM or the application layer. Dependencies flow one way, UI → core.
 */
const CORE_FORBIDDEN_IMPORTS = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'framer-motion', 'motion', 'motion/*'],
    message: 'src/core stays pure TypeScript — no React, DOM or animation imports (ADR-0001).',
  },
  {
    group: ['**/components/**', '**/hooks/**', '**/services/**', '**/app/**', '**/App', '**/main'],
    message:
      'src/core must not depend on the UI/application layer — dependencies flow UI → core only (ADR-0001).',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
    ],
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // --- The architectural boundary: src/core is pure domain ---
  {
    files: ['src/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: CORE_FORBIDDEN_IMPORTS }],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core must not touch the DOM (ADR-0001).' },
        { name: 'document', message: 'src/core must not touch the DOM (ADR-0001).' },
        { name: 'localStorage', message: 'src/core must not touch the DOM (ADR-0001).' },
      ],
    },
  },

  // --- Config files and the e2e suite run under Node, not the browser ---
  {
    files: ['*.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // --- This config file itself belongs to no TS project, so type-aware rules cannot run ---
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Last, so it wins: switches off every rule that fights Prettier.
  prettier,
);
