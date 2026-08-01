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
  /**
   * The run worker is spawned with `{ type: 'module' }`, so its chunk has to be a module too —
   * Vite's default for workers is an IIFE, which loads but stops the worker from ever being
   * code-split. A browser that refuses module workers fires `error` instead, and
   * `services/program-runner` answers that by running the program on this thread.
   */
  worker: { format: 'es' },
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
      // Test fixtures are scaffolding, not shipped behaviour: counting them moves the
      // thresholds for reasons that have nothing to do with the code under test.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__fixtures__/**', 'src/test/**', 'src/main.tsx'],
      thresholds: {
        // The domain layer is the part that has to be correct; CI enforces it, not review.
        'src/core/**/*.ts': { lines: 90, branches: 90, functions: 90 },
      },
    },
  },
});
