import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { execute, parseClassFile } from '../index';
import { expectCompleted, lastFrameOf, localValue } from './__fixtures__/expect-execution';

/**
 * Differential test against a real JVM: `expectedResult` in the manifest is what `java`
 * printed for each example when the fixtures were built, so these assertions fail the moment
 * the interpreter drifts from the reference implementation.
 *
 * The manifest is read straight from disk with a local shape check — the loader in
 * `src/services` belongs to the UI layer and must not leak into the domain tests.
 */
const EXAMPLES = new URL('../../../public/examples/', import.meta.url);

interface ManifestExample {
  readonly id: string;
  readonly classFile: string;
  readonly entryMethod: string;
  readonly resultVariable: string;
  readonly expectedResult: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function toExample(value: unknown): ManifestExample {
  if (!isRecord(value)) {
    throw new Error('manifest entry is not an object');
  }
  const { id, classFile, entryMethod, resultVariable, expectedResult } = value;
  if (
    typeof id !== 'string' ||
    typeof classFile !== 'string' ||
    typeof entryMethod !== 'string' ||
    typeof resultVariable !== 'string' ||
    typeof expectedResult !== 'number'
  ) {
    throw new Error(`manifest entry has unexpected fields: ${JSON.stringify(value)}`);
  }
  return { id, classFile, entryMethod, resultVariable, expectedResult };
}

function readManifest(): readonly ManifestExample[] {
  const parsed: unknown = JSON.parse(readFileSync(new URL('manifest.json', EXAMPLES), 'utf8'));
  if (!isRecord(parsed) || !isArray(parsed.examples) || parsed.examples.length === 0) {
    throw new Error('manifest.json has no examples');
  }
  return parsed.examples.map(toExample);
}

describe('execute — differential against the real JVM', () => {
  const examples = readManifest();

  it.each(examples)(
    '$id: $resultVariable equals $expectedResult',
    ({ classFile, entryMethod, resultVariable, expectedResult }) => {
      const bytes = new Uint8Array(readFileSync(new URL(classFile, EXAMPLES)));
      const result = expectCompleted(execute(parseClassFile(bytes.buffer), { entryMethod }));
      const entryFrame = lastFrameOf(result.snapshots, entryMethod);

      expect(localValue(entryFrame, resultVariable)).toBe(expectedResult);
      // Every example is long enough to be worth scrubbing and short enough to replay.
      expect(result.snapshots.length).toBeGreaterThanOrEqual(30);
      expect(result.snapshots.length).toBeLessThanOrEqual(2_000);
    },
  );
});
