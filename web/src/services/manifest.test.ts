/**
 * Contract test for the committed fixtures. The manifest is read from disk rather than
 * through `fetch` or a mock: the artifact under test is the one that ships.
 */

/// <reference types="node" />
// tsconfig.app.json narrows `types` to "vite/client" (application code targets the browser),
// so the `node:*` module declarations have to be pulled in explicitly here.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as process from 'node:process';
import { describe, expect, it } from 'vitest';

import { exampleManifestSchema, parseExampleManifest, type ExampleManifest } from './manifest';

/**
 * Resolved from cwd, not from `import.meta.url`: under jsdom Vitest serves modules over http,
 * so `import.meta.url` is not a `file:` URL. Vitest roots at `web/` (where vite.config.ts
 * lives); the second candidate covers a run from the repo root.
 */
function resolveUnderWeb(...segments: readonly string[]): string {
  const candidates = [
    resolve(process.cwd(), ...segments),
    resolve(process.cwd(), 'web', ...segments),
  ];
  const found = candidates.find((directory) => existsSync(directory));
  if (found === undefined) {
    throw new Error(
      `${segments.join('/')} not found (looked in: ${candidates.join(', ')}). ` +
        'Generate the fixtures with `npm run fixtures -w web`.',
    );
  }
  return found;
}

const EXAMPLES_DIR = resolveUnderWeb('public', 'examples');

/** The Java the fixtures build compiles — the other end of the manifest. */
const SOURCE_DIR = resolveUnderWeb('fixtures', 'src');

function readManifest(): ExampleManifest {
  const raw: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'manifest.json'), 'utf8'));
  return parseExampleManifest(raw);
}

describe('example manifest', () => {
  it('validates against the schema', () => {
    expect(() => readManifest()).not.toThrow();
  });

  it('lists exactly the examples there are sources for', () => {
    // Every `.java` in `fixtures/src` is meant to reach the UI. The build copies the classes
    // it is told about, so a source added there and nowhere else would simply never ship —
    // this is what notices. Written against the sources rather than a list of names, so
    // adding the next example does not mean editing this test.
    const sources = readdirSync(SOURCE_DIR)
      .filter((file) => file.endsWith('.java'))
      .sort();

    expect(
      readManifest()
        .examples.map((example) => example.sourceFile)
        .sort(),
    ).toEqual(sources);
  });

  // Reference values computed by a real JVM in build-fixtures.mjs.
  it.each([
    { id: 'factorial', expectedResult: 24 },
    { id: 'fibonacci', expectedResult: 13 },
    { id: 'gcd', expectedResult: 21 },
    // a[0] of {5, 3, 4, 1, 2} once the sort has run.
    { id: 'bubble-sort', expectedResult: 1 },
    // Steps from 7 down to 1, months in a common year, and 3^13.
    { id: 'collatz', expectedResult: 16 },
    { id: 'days-in-year', expectedResult: 365 },
    { id: 'fast-power', expectedResult: 1_594_323 },
  ])('$id has expectedResult $expectedResult', ({ id, expectedResult }) => {
    const entry = readManifest().examples.find((example) => example.id === id);
    expect(entry?.expectedResult).toBe(expectedResult);
  });

  it('carries the console output a real JVM produced, for the example that prints', () => {
    const entry = readManifest().examples.find((example) => example.id === 'collatz');

    // The whole sequence, one term per line — what `java Collatz` wrote during the build.
    expect(entry?.expectedOutput).toEqual(
      ['7', '22', '11', '34', '17', '52', '26', '13', '40', '20', '10', '5', '16', '8', '4', '2', '1'], // prettier-ignore
    );
  });

  it('leaves the field off for an example that prints nothing', () => {
    const silent = readManifest().examples.filter((example) => example.id !== 'collatz');

    // Absence is the statement: these programs leave their answer in a local variable and
    // write nothing at all, which is why they have no console in the UI either.
    expect(silent.map((example) => example.expectedOutput)).toEqual(silent.map(() => undefined));
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
      // The welcome card shows the tagline whole, so it has to fit on one line.
      expect(example.tagline.length, example.id).toBeLessThanOrEqual(60);
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

  it('rejects console output that is not a list of lines', () => {
    const manifest = readManifest();
    const [first, ...rest] = manifest.examples;
    const result = exampleManifestSchema.safeParse({
      ...manifest,
      examples: [{ ...first, expectedOutput: 'one line' }, ...rest],
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
