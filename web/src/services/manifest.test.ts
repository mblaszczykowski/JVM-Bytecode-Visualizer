/**
 * Contract test for the committed fixtures. The manifest is read from disk rather than
 * through `fetch` or a mock: the artifact under test is the one that ships.
 */

/// <reference types="node" />
// tsconfig.app.json narrows `types` to "vite/client" (application code targets the browser),
// so the `node:*` module declarations have to be pulled in explicitly here.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as process from 'node:process';
import { describe, expect, it } from 'vitest';

import { exampleManifestSchema, parseExampleManifest, type ExampleManifest } from './manifest';

/**
 * Resolved from cwd, not from `import.meta.url`: under jsdom Vitest serves modules over http,
 * so `import.meta.url` is not a `file:` URL. Vitest roots at `web/` (where vite.config.ts
 * lives); the second candidate covers a run from the repo root.
 */
function resolveExamplesDir(): string {
  const candidates = [
    resolve(process.cwd(), 'public', 'examples'),
    resolve(process.cwd(), 'web', 'public', 'examples'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, 'manifest.json')));
  if (found === undefined) {
    throw new Error(
      `manifest.json not found (looked in: ${candidates.join(', ')}). ` +
        'Generate the fixtures with `npm run fixtures -w web`.',
    );
  }
  return found;
}

const EXAMPLES_DIR = resolveExamplesDir();

function readManifest(): ExampleManifest {
  const raw: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'manifest.json'), 'utf8'));
  return parseExampleManifest(raw);
}

describe('example manifest', () => {
  it('validates against the schema', () => {
    expect(() => readManifest()).not.toThrow();
  });

  it('contains the four expected examples', () => {
    const manifest = readManifest();
    expect(manifest.examples.map((example) => example.id)).toEqual([
      'factorial',
      'fibonacci',
      'sum-of-squares',
      'gcd',
    ]);
  });

  // Reference values computed by a real JVM in build-fixtures.mjs.
  it.each([
    { id: 'factorial', expectedResult: 24 },
    { id: 'fibonacci', expectedResult: 13 },
    { id: 'gcd', expectedResult: 21 },
  ])('$id has expectedResult $expectedResult', ({ id, expectedResult }) => {
    const entry = readManifest().examples.find((example) => example.id === id);
    expect(entry?.expectedResult).toBe(expectedResult);
  });

  it('points at existing .class and .java files', () => {
    for (const example of readManifest().examples) {
      expect(existsSync(join(EXAMPLES_DIR, example.classFile)), example.classFile).toBe(true);
      expect(existsSync(join(EXAMPLES_DIR, example.sourceFile)), example.sourceFile).toBe(true);
    }
  });

  it('points at .class files with a valid 0xCAFEBABE magic', () => {
    for (const example of readManifest().examples) {
      const bytes = readFileSync(join(EXAMPLES_DIR, example.classFile));
      expect(bytes.readUInt32BE(0).toString(16), example.classFile).toBe('cafebabe');
    }
  });

  it('keeps the entry point convention for every example', () => {
    for (const example of readManifest().examples) {
      expect(example.entryMethod).toBe('main');
      expect(example.resultVariable).toBe('result');
      expect(example.description.length).toBeGreaterThan(20);
    }
  });
});

describe('manifest schema', () => {
  it('rejects unknown fields', () => {
    const manifest = readManifest();
    const result = exampleManifestSchema.safeParse({ ...manifest, unexpected: true });
    expect(result.success).toBe(false);
  });

  it('rejects an expectedResult outside the int32 range', () => {
    const manifest = readManifest();
    const [first, ...rest] = manifest.examples;
    const result = exampleManifestSchema.safeParse({
      ...manifest,
      examples: [{ ...first, expectedResult: 2_147_483_648 }, ...rest],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate identifiers', () => {
    const manifest = readManifest();
    const [first] = manifest.examples;
    const result = exampleManifestSchema.safeParse({ ...manifest, examples: [first, first] });
    expect(result.success).toBe(false);
  });
});
