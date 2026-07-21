/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The React Compiler memoises components and hooks for us, so the source keeps saying what it
 * computes instead of how it caches. `target: '18'` makes it emit the `react-compiler-runtime`
 * polyfill of `useMemoCache`, which React 18 does not ship itself.
 */
const reactCompiler: [string, { readonly target: string }] = [
  'babel-plugin-react-compiler',
  { target: '18' },
];

export default defineConfig({
  plugins: [react({ babel: { plugins: [reactCompiler] } }), tailwindcss()],
  test: {
    // Two projects mirror the ADR-0001 boundary: `core/` is plain TypeScript and has to pass
    // its tests without a DOM anywhere in sight.
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: ['src/core/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.tsx', 'src/{components,hooks,services}/**/*.test.ts'],
        },
      },
    ],
    // The Playwright suite in tests/e2e is deliberately part of neither project.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      thresholds: {
        // The domain layer is the part that has to be correct; CI enforces it, not review.
        'src/core/**/*.ts': { lines: 90, branches: 90, functions: 90 },
      },
    },
  },
});
