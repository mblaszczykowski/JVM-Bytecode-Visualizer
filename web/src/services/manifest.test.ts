/**
 * Test kontraktu commitowanych fixtures (plan.md §9 Faza 4).
 *
 * Czyta manifest z dysku — nie z `fetch`-a i nie z mocka — bo sprawdzanym artefaktem jest
 * właśnie to, co leży w repozytorium i co pojedzie na produkcję. Jeżeli ktoś zmieni
 * `build-fixtures.mjs` albo źródło przykładu tak, że wynik przestanie się zgadzać
 * z prawdziwą JVM, ten test upadnie zanim ktokolwiek uruchomi interpreter.
 */

/// <reference types="node" />
// tsconfig.app.json zawęża `types` do "vite/client" (kod aplikacji celuje w przeglądarkę),
// więc deklaracje modułów `node:*` trzeba w tym teście dociągnąć jawnie.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as process from 'node:process';
import { describe, expect, it } from 'vitest';

import { exampleManifestSchema, parseExampleManifest, type ExampleManifest } from './manifest';

/**
 * Katalog fixtures liczymy od cwd, a nie od `import.meta.url`: w środowisku jsdom Vitest
 * serwuje moduły po http, więc `import.meta.url` nie jest URL-em `file:`. Vitest ma root
 * w `web/` (tam leży vite.config.ts), a drugi kandydat ratuje uruchomienie z roota repo.
 */
function resolveExamplesDir(): string {
  const candidates = [
    resolve(process.cwd(), 'public', 'examples'),
    resolve(process.cwd(), 'web', 'public', 'examples'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, 'manifest.json')));
  if (found === undefined) {
    throw new Error(
      `Nie znaleziono manifest.json (szukano w: ${candidates.join(', ')}). ` +
        'Wygeneruj fixtures poleceniem `npm run fixtures -w web`.',
    );
  }
  return found;
}

const EXAMPLES_DIR = resolveExamplesDir();

function readManifest(): ExampleManifest {
  const raw: unknown = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'manifest.json'), 'utf8'));
  return parseExampleManifest(raw);
}

describe('manifest przykładów', () => {
  it('waliduje się schematem', () => {
    expect(() => readManifest()).not.toThrow();
  });

  it('zawiera cztery przykłady z plan.md §7', () => {
    const manifest = readManifest();
    expect(manifest.examples.map((example) => example.id)).toEqual([
      'factorial',
      'fibonacci',
      'sum-of-squares',
      'gcd',
    ]);
  });

  // Wartości referencyjne z plan.md §7, policzone przez prawdziwą JVM w build-fixtures.mjs.
  it.each([
    { id: 'factorial', expectedResult: 24 },
    { id: 'fibonacci', expectedResult: 13 },
    { id: 'gcd', expectedResult: 21 },
  ])('$id ma expectedResult $expectedResult', ({ id, expectedResult }) => {
    const entry = readManifest().examples.find((example) => example.id === id);
    expect(entry?.expectedResult).toBe(expectedResult);
  });

  it('wskazuje istniejące pliki .class i .java', () => {
    for (const example of readManifest().examples) {
      expect(existsSync(join(EXAMPLES_DIR, example.classFile)), example.classFile).toBe(true);
      expect(existsSync(join(EXAMPLES_DIR, example.sourceFile)), example.sourceFile).toBe(true);
    }
  });

  it('wskazuje pliki .class z poprawnym magic 0xCAFEBABE', () => {
    for (const example of readManifest().examples) {
      const bytes = readFileSync(join(EXAMPLES_DIR, example.classFile));
      expect(bytes.readUInt32BE(0).toString(16), example.classFile).toBe('cafebabe');
    }
  });

  it('trzyma konwencję startu z plan.md §5.4 dla każdego przykładu', () => {
    for (const example of readManifest().examples) {
      expect(example.entryMethod).toBe('main');
      expect(example.resultVariable).toBe('result');
      expect(example.description.length).toBeGreaterThan(20);
    }
  });
});

describe('schemat manifestu', () => {
  it('odrzuca nieznane pola', () => {
    const manifest = readManifest();
    const result = exampleManifestSchema.safeParse({ ...manifest, unexpected: true });
    expect(result.success).toBe(false);
  });

  it('odrzuca expectedResult spoza zakresu int32', () => {
    const manifest = readManifest();
    const [first, ...rest] = manifest.examples;
    const result = exampleManifestSchema.safeParse({
      ...manifest,
      examples: [{ ...first, expectedResult: 2_147_483_648 }, ...rest],
    });
    expect(result.success).toBe(false);
  });

  it('odrzuca zduplikowane identyfikatory', () => {
    const manifest = readManifest();
    const [first] = manifest.examples;
    const result = exampleManifestSchema.safeParse({ ...manifest, examples: [first, first] });
    expect(result.success).toBe(false);
  });
});
