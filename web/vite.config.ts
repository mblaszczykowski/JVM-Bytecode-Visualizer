/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Dwa projekty odzwierciedlają granicę z ADR-0001/§11.1: `core/` jest czystym
    // TypeScriptem i musi przechodzić testy bez jakiegokolwiek DOM-u.
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
    // Testy e2e (Playwright) żyją w tests/e2e i celowo nie są objęte żadnym projektem.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      // Progi pokrycia wchodzą w Fazie 3 (plan §9).
    },
  },
});
