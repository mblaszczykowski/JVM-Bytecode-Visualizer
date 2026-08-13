import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const REACT_PACKAGES = [
  'react',
  'react/*',
  'react-dom',
  'react-dom/*',
  'framer-motion',
  'motion',
  'motion/*',
];

const CORE_FORBIDDEN_IMPORTS = [
  {
    group: REACT_PACKAGES,
    message: 'src/core stays pure TypeScript: no React, DOM or animation imports (ADR-0001).',
  },
  {
    group: ['**/components/**', '**/hooks/**', '**/services/**', '**/app/**', '**/App', '**/main'],
    message:
      'src/core must not depend on the UI/application layer; dependencies flow UI to core only (ADR-0001).',
  },
];

const REACT_LAYER_MODULES = String.raw`(^|/)(components|hooks)/(?!__fixtures__/)|(^|/)(App|main)$`;

// Everything outside src/core reaches core through the three barrels. A deep import of a module
// the barrel already re-exports is drift, and it is how a boundary stops being one.
const CORE_DEEP_IMPORT = {
  regex: String.raw`(^|/)core/(classfile|disassembler|interpreter)/(?!index$)(?!__fixtures__/)[a-z-]+$`,
  message:
    'Import from the module barrel (core/classfile, core/disassembler, core/interpreter) rather than reaching past it.',
};

const SERVICES_FORBIDDEN_IMPORTS = [
  {
    group: REACT_PACKAGES,
    message:
      'src/services is the application layer: it holds no React, so every derivation can be tested without rendering.',
  },
  {
    regex: REACT_LAYER_MODULES,
    message:
      'src/services must not depend on the React layer above it; dependencies flow components and hooks to services to core. A recorded run under __fixtures__ is test data and stays allowed.',
  },
];

const WORKER_FORBIDDEN_IMPORTS = [
  {
    group: REACT_PACKAGES,
    message: 'A worker has no DOM and no React; it runs the interpreter and posts snapshots back.',
  },
  {
    regex: REACT_LAYER_MODULES,
    message:
      'A worker may use src/core and src/services only. Importing the React layer would pull the whole UI into the worker bundle.',
  },
];

const NO_DOM_GLOBALS = ['window', 'document', 'localStorage'].map((name) => ({
  name,
  message:
    'No DOM here: src/core is plain TypeScript (ADR-0001) and a worker has no window (ADR-0006). Take what you need as an argument from the layer that does have a DOM.',
}));

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
    pattern: String.raw`\brounded-(?:[trblxyse]{1,2}-)?full\b`,
    message:
      'Radii are 10/8/6/6/5/4 (rounded-panel / -card / -row / -control / -code / -chip). rounded-full is allowed only on something genuinely circular; disable this line and say which.',
  },
  {
    pattern: String.raw`\brounded-(?:[trblxyse]{1,2}-)?(?:\[|sm|md|lg|xl|2xl|3xl|4xl)`,
    message:
      'Every radius is a token: rounded-panel / -card / -row / -control / -code / -chip. Add one to the @theme block in src/index.css rather than an arbitrary or Tailwind-default radius.',
  },
  {
    pattern: String.raw`\bshadow-\[`,
    message:
      'The shadow grammar is the inset hairline, and every shadow is a --shadow-* token in src/index.css. Add one there instead of writing the shadow inline.',
  },
  {
    pattern: String.raw`\bbg-(?:accent|ok|warn|error)\/`,
    message:
      'A tinted surface is a token: bg-accent-wash / -fill, bg-warn-wash, bg-error-wash. An alpha over whatever happens to be behind is how the ad-hoc grey ramp came back.',
  },
  {
    pattern: String.raw`\btext-[a-z][a-z-]*\/\d`,
    message:
      'Text hierarchy is the four steps (text-fg / -2 / -3 / -dim). An alpha on a text colour is opacity hierarchy under another name.',
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

const EM_DASH = '—';

const EM_DASH_MESSAGE =
  'No em-dashes anywhere in the source or the copy it renders. Use a period, a comma, a colon or parentheses; the placeholder for an absent value is an en dash.';

const PROSE_RULES = [
  { selector: `Literal[value=/${EM_DASH}/]`, message: EM_DASH_MESSAGE },
  { selector: `TemplateElement[value.raw=/${EM_DASH}/]`, message: EM_DASH_MESSAGE },
  { selector: `JSXText[value=/${EM_DASH}/]`, message: EM_DASH_MESSAGE },
  {
    selector: 'JSXExpressionContainer > JSXEmptyExpression',
    message:
      'An empty {} in JSX renders nothing and reads as a deleted comment. Delete the braces too.',
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

  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PROSE_RULES],
    },
  },

  {
    files: ['src/**/*.tsx', 'src/components/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PROSE_RULES, ...BANNED_CLASSNAME_RULES],
    },
  },

  {
    files: ['src/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: CORE_FORBIDDEN_IMPORTS }],
      'no-restricted-globals': ['error', ...NO_DOM_GLOBALS],
    },
  },

  {
    files: ['src/services/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...SERVICES_FORBIDDEN_IMPORTS, CORE_DEEP_IMPORT] },
      ],
    },
  },

  {
    files: ['src/{components,hooks}/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [CORE_DEEP_IMPORT] }],
    },
  },

  {
    files: ['src/workers/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: WORKER_FORBIDDEN_IMPORTS }],
      // The DOM lib is in scope here and these tests run under jsdom, so a DOM reference would
      // otherwise typecheck and pass, then throw in the real worker. The worker's own globals
      // (self, postMessage, addEventListener) are not restricted.
      'no-restricted-globals': ['error', ...NO_DOM_GLOBALS],
    },
  },

  {
    files: ['*.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },

  prettier,
);
