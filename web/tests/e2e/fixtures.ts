import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { test } from '@playwright/test';

export function fixturePath(fileName: string): string {
  return join(test.info().project.testDir, 'fixtures', fileName);
}

export interface ManifestExample {
  readonly id: string;
  readonly title: string;
  readonly expectedResult: number;
  readonly expectedOutput?: readonly string[];
}

export function bundledExamples(): readonly ManifestExample[] {
  const candidates = [
    resolve(process.cwd(), 'public', 'examples', 'manifest.json'),
    resolve(process.cwd(), 'web', 'public', 'examples', 'manifest.json'),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path === undefined) {
    throw new Error(`manifest.json not found (looked in: ${candidates.join(', ')}).`);
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { examples: ManifestExample[] };
  return manifest.examples;
}

export function printingExample(): ManifestExample & {
  readonly expectedOutput: readonly string[];
} {
  const printing = bundledExamples().find((example) => (example.expectedOutput?.length ?? 0) > 0);
  if (printing?.expectedOutput === undefined) {
    throw new Error('no bundled example prints anything, so the console cannot be exercised');
  }
  return { ...printing, expectedOutput: printing.expectedOutput };
}
