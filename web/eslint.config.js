// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Wzorce importów zakazane w `src/core/**` — egzekwują ADR-0001 i plan §11.1:
 * warstwa domenowa (parser, disassembler, interpreter) nie zna React-a, DOM-u
 * ani warstwy aplikacyjnej. Przepływ zależności jest jednokierunkowy: UI → core.
 */
const CORE_FORBIDDEN_IMPORTS = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'framer-motion', 'motion', 'motion/*'],
    message:
      'src/core musi pozostać czystym TypeScriptem — bez React/DOM/animacji (ADR-0001, plan §11.1).',
  },
  {
    group: ['**/components/**', '**/hooks/**', '**/services/**', '**/app/**', '**/App', '**/main'],
    message:
      'src/core nie może zależeć od warstwy UI/aplikacji — zależności płyną wyłącznie UI → core (ADR-0001, plan §11.1).',
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

  // --- TypeScript: strict + stylistic z pełną analizą typów ---
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

  // --- Kod aplikacji (przeglądarka) ---
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // --- Granica architektoniczna: src/core jest czystą domeną ---
  {
    files: ['src/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: CORE_FORBIDDEN_IMPORTS }],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core nie może dotykać DOM-u (ADR-0001).' },
        { name: 'document', message: 'src/core nie może dotykać DOM-u (ADR-0001).' },
        { name: 'localStorage', message: 'src/core nie może dotykać DOM-u (ADR-0001).' },
      ],
    },
  },

  // --- Pliki konfiguracyjne i testy e2e działają w Node ---
  {
    files: ['*.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // --- Sam plik konfiguracji ESLint nie należy do żadnego projektu TS ---
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Prettier na końcu: wyłącza reguły kolidujące z formatowaniem.
  prettier,
);
