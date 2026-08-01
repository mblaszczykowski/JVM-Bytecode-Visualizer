import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { test } from '@playwright/test';

/** Absolute path of a file in `tests/e2e/fixtures/`, wherever the run was started from. */
export function fixturePath(fileName: string): string {
  return join(test.info().project.testDir, 'fixtures', fileName);
}

/** One entry of `public/examples/manifest.json`, as the specs read it. */
export interface ManifestExample {
  readonly id: string;
  readonly title: string;
  readonly expectedResult: number;
  /** Absent for the examples that print nothing. */
  readonly expectedOutput?: readonly string[];
}

/**
 * The manifest the app is about to fetch, read from disk.
 *
 * It is the same artifact the preview server hands the browser, so a spec can say "as many
 * cards as there are examples" or "the lines a real JVM printed" without a number of its own
 * to keep up to date. The schema is validated in the unit tests; here it is only read.
 *
 * Resolved from cwd rather than from `test.info()`, which is a run-time-only fixture: a spec
 * may read the manifest while it is still collecting its tests.
 */
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

/** The one example that prints — the reason the Console panel exists. */
export function printingExample(): ManifestExample & {
  readonly expectedOutput: readonly string[];
} {
  const printing = bundledExamples().find((example) => (example.expectedOutput?.length ?? 0) > 0);
  if (printing?.expectedOutput === undefined) {
    throw new Error('no bundled example prints anything, so the console cannot be exercised');
  }
  return { ...printing, expectedOutput: printing.expectedOutput };
}
