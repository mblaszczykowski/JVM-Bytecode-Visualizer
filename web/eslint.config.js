import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const CORE_FORBIDDEN_IMPORTS = [
  {
    group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'framer-motion', 'motion', 'motion/*'],
    message: 'src/core stays pure TypeScript: no React, DOM or animation imports (ADR-0001).',
  },
  {
    group: ['**/components/**', '**/hooks/**', '**/services/**', '**/app/**', '**/App', '**/main'],
    message:
      'src/core must not depend on the UI/application layer; dependencies flow UI to core only (ADR-0001).',
  },
];

const BANNED_CLASSNAMES = [
  {
    pattern: String.raw`(?:text|bg|border|decoration|fill|stroke|ring|divide|shadow)-white\/`,
    message:
      'Alpha-over-alpha colour is gone: use the four text steps (text-fg / -2 / -3 / -dim), a surface (bg-panel, bg-raised, bg-sunken, bg-overlay) or the hairline (bg-line / -strong). See src/index.css.',
  },
  {
    pattern: String.raw`(?:text|bg|border)-black\/`,
    message: 'Use bg-scrim for dialog scrims; nothing else in this interface is pure black.',
  },
  {
    pattern: String.raw`\brounded-full\b`,
    message:
      'Radii are 10/8/6/6/5 (rounded-panel / -card / -row / -control / -code). rounded-full is allowed only on something genuinely circular; disable this line and say which.',
  },
  {
    pattern: String.raw`\bbackdrop-(?:blur|saturate|brightness)`,
    message:
      'The glass is gone: surfaces are flat and opaque, and backdrop-filter was the one expensive effect in this layer.',
  },
  {
    pattern: String.raw`\b(?:rounded|shadow|bg)-shell\b`,
    message: 'The shell token was deleted with the floating sheet; the frame fills the viewport.',
  },
  {
    pattern: String.raw`\[#[0-9a-fA-F]{3,8}\]|\[rgb[a]?\(`,
    message:
      'No raw colour literals in a className. Add a token to the @theme block in src/index.css, as a light-dark() pair.',
  },
  {
    pattern: String.raw`\b(?<!disabled:)opacity-(?:[1-9]|[1-8][0-9])\b`,
    message:
      'Hierarchy comes from the four text steps and the surface ramp, not from opacity. To dim a whole composed row use the row-unreached / row-unsupported utilities; opacity itself is for something fading in or out.',
  },
  {
    pattern: String.raw`\b(?:gap-x|gap-y|gap|px|py|pt|pb|pl|pr|p|mx|my|mt|mb|ml|mr|m)-\[\d`,
    message:
      'Spacing is on a scale: use Tailwind steps (p-0.5 … p-7 = 2px … 28px), not an arbitrary pixel value.',
  },
];

const BANNED_CLASSNAME_RULES = BANNED_CLASSNAMES.flatMap(({ pattern, message }) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
]);

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

  {
    files: ['src/**/*.tsx', 'src/components/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...BANNED_CLASSNAME_RULES],
    },
  },

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

  {
    files: ['*.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },

  prettier,
);
