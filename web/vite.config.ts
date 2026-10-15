/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

import { siteMetadata } from './scripts/site-metadata';

const reactCompiler: [string, { readonly target: string }] = [
  'babel-plugin-react-compiler',
  { target: '18' },
];

export default defineConfig(({ mode }) => ({
  plugins: [
    react({ babel: { plugins: [reactCompiler] } }),
    tailwindcss(),
    siteMetadata({ ...process.env, ...loadEnv(mode, process.cwd(), 'VITE_') }),
  ],
  worker: { format: 'es' },
  build: {
    sourcemap: 'hidden',
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
          include: ['src/**/*.test.tsx', 'src/{components,hooks,services,workers}/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.ts', 'fixtures/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__fixtures__/**', 'src/test/**', 'src/main.tsx'],
      thresholds: {
        perFile: true,
        'src/core/**/*.ts': { lines: 90, branches: 90, functions: 90 },
        'src/services/**/*.ts': { lines: 80, branches: 40, functions: 85 },
      },
    },
  },
}));
