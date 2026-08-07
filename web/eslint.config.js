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

/**
 * Utility classes the design system replaced, banned at author time.
 *
 * The visual layer was rebuilt once already because it had accumulated twenty-two ad-hoc
 * `text-white/NN` greys, thirteen shadow tokens and twenty-nine `rounded-full`. None of those
 * was a bad decision on its own; the damage was that nothing stopped the twenty-third. These
 * patterns are how that state comes back, so they fail the build instead.
 *
 * Every one of them has a token that says the same thing — see `src/index.css`, which carries
 * the reasoning. A genuine exception (the two things on screen that really are circles) is an
 * `eslint-disable-next-line` with a comment saying which one and why: the point is not that
 * exceptions are forbidden, it is that they have to be argued in the diff.
 */
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
      'Radii are 10/8/6/6/5 (rounded-panel / -card / -row / -control / -code). rounded-full is allowed only on something genuinely circular — disable this line and say which.',
  },
  {
    pattern: String.raw`\bbackdrop-(?:blur|saturate|brightness)`,
    message:
      'The glass is gone: surfaces are flat and opaque, and backdrop-filter was the one expensive effect in this layer.',
  },
  {
    pattern: String.raw`\b(?:rounded|shadow|bg)-shell\b`,
    message: 'The shell token was deleted with the floating sheet — the frame fills the viewport.',
  },
  {
    pattern: String.raw`\[#[0-9a-fA-F]{3,8}\]|\[rgb[a]?\(`,
    message:
      'No raw colour literals in a className. Add a token to the @theme block in src/index.css, as a light-dark() pair.',
  },
  {
    // `disabled:` / `aria-disabled:` are exempt — that is a control state, not a text step,
    // and it is the one place WCAG stops asking for contrast.
    pattern: String.raw`\b(?<!disabled:)opacity-(?:[1-9]|[1-8][0-9])\b`,
    message:
      'Hierarchy comes from the four text steps and the surface ramp, not from opacity. To dim a whole composed row use the row-unreached / row-unsupported utilities; opacity itself is for something fading in or out.',
  },
];

/**
 * `no-restricted-syntax` selectors matching a banned pattern inside any JSX string attribute
 * (`className="…"`) or any template/string literal (the `const ROW = '…'` style this codebase
 * uses for shared class strings).
 */
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

  // --- The design system, enforced where classes are written ---
  {
    files: ['src/**/*.tsx', 'src/components/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...BANNED_CLASSNAME_RULES],
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
