/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const reactCompiler: [string, { readonly target: string }] = [
  'babel-plugin-react-compiler',
  { target: '18' },
];

export default defineConfig({
  plugins: [react({ babel: { plugins: [reactCompiler] } }), tailwindcss()],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
        },
      },
    },
  },
  test: {
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__fixtures__/**', 'src/test/**', 'src/main.tsx'],
      thresholds: {
        'src/core/**/*.ts': { lines: 90, branches: 90, functions: 90 },
      },
    },
  },
});
