/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as process from 'node:process';
import { describe, expect, it } from 'vitest';

import { exampleManifestSchema, parseExampleManifest, type ExampleManifest } from './manifest';

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
    const sources = readdirSync(SOURCE_DIR)
      .filter((file) => file.endsWith('.java'))
      .sort();

    expect(
      readManifest()
        .examples.map((example) => example.sourceFile)
        .sort(),
    ).toEqual(sources);
  });

  it.each([
    { id: 'factorial', expectedResult: 24 },
    { id: 'fibonacci', expectedResult: 13 },
    { id: 'gcd', expectedResult: 21 },
    { id: 'bubble-sort', expectedResult: 1 },
    { id: 'collatz', expectedResult: 16 },
    { id: 'days-in-year', expectedResult: 365 },
    { id: 'fast-power', expectedResult: 1_594_323 },
  ])('$id has expectedResult $expectedResult', ({ id, expectedResult }) => {
    const entry = readManifest().examples.find((example) => example.id === id);
    expect(entry?.expectedResult).toBe(expectedResult);
  });

  it('carries the console output a real JVM produced, for the example that prints', () => {
    const entry = readManifest().examples.find((example) => example.id === 'collatz');

    expect(entry?.expectedOutput).toEqual(
      ['7', '22', '11', '34', '17', '52', '26', '13', '40', '20', '10', '5', '16', '8', '4', '2', '1'], // prettier-ignore
    );
  });

  it('leaves the field off for an example that prints nothing', () => {
    const silent = readManifest().examples.filter((example) => example.id !== 'collatz');

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

  it.each([
    { name: 'a relative path out of the examples directory', classFile: '../../secret.class' },
    { name: 'an absolute path', classFile: '/etc/passwd.class' },
    { name: 'a query string', classFile: 'A.class?x=1' },
    { name: 'a percent-encoded traversal', classFile: 'A%2e%2e.class' },
    { name: 'a fragment', classFile: 'A.class#frag' },
  ])('refuses $name as a class file name', ({ classFile }) => {
    const manifest = readManifest();
    const [first, ...rest] = manifest.examples;

    const result = exampleManifestSchema.safeParse({
      ...manifest,
      examples: [{ ...first, classFile }, ...rest],
    });

    expect(result.success).toBe(false);
  });

  it('refuses a source file name that is not a plain .java file beside the class', () => {
    const manifest = readManifest();
    const [first, ...rest] = manifest.examples;

    for (const sourceFile of ['../Factorial.java', '/Factorial.java', 'Factorial.java?x=1']) {
      const result = exampleManifestSchema.safeParse({
        ...manifest,
        examples: [{ ...first, sourceFile }, ...rest],
      });

      expect(result.success, sourceFile).toBe(false);
    }
  });

  it('rejects duplicate identifiers', () => {
    const manifest = readManifest();
    const [first] = manifest.examples;
    const result = exampleManifestSchema.safeParse({ ...manifest, examples: [first, first] });
    expect(result.success).toBe(false);
  });
});
