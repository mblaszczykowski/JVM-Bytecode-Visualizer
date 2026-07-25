import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { execute, parseClassFile, type Snapshot } from '../index';
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

function runExample(classFile: string, entryMethod: string): readonly Snapshot[] {
  const bytes = new Uint8Array(readFileSync(new URL(classFile, EXAMPLES)));
  return expectCompleted(execute(parseClassFile(bytes.buffer), { entryMethod })).snapshots;
}

describe('execute — differential against the real JVM', () => {
  const examples = readManifest();

  it.each(examples)(
    '$id: $resultVariable equals $expectedResult',
    ({ classFile, entryMethod, resultVariable, expectedResult }) => {
      const snapshots = runExample(classFile, entryMethod);
      const entryFrame = lastFrameOf(snapshots, entryMethod);

      expect(localValue(entryFrame, resultVariable)).toBe(expectedResult);
      // Every example is long enough to be worth scrubbing and short enough to replay.
      expect(snapshots.length).toBeGreaterThanOrEqual(30);
      expect(snapshots.length).toBeLessThanOrEqual(2_000);
    },
  );
});

/**
 * The right answer by the right route. `factorial(4)` reaches 24 down exactly one path, and
 * the path below is read off `javap -c Factorial` rather than off a run:
 *
 *   static int factorial(int);
 *      0: iload_0        7: iload_0          public static void main(java.lang.String[]);
 *      1: iconst_1       8: iload_0             0: iconst_4
 *      2: if_icmpgt 7    9: iconst_1            1: invokestatic #7
 *      5: iconst_1      10: isub                4: istore_1
 *      6: ireturn       11: invokestatic #7     5: return
 *                       14: imul
 *                       15: ireturn
 *
 * `n > 1` takes the branch at pc 2 and walks 7…11 into the next call; `n <= 1` falls through
 * to the `return 1` at pc 5; every call comes back at pc 14 to multiply and return.
 */
const DESCEND: readonly number[] = [0, 1, 2, 7, 8, 9, 10, 11];
const BASE_CASE: readonly number[] = [0, 1, 2, 5, 6];
const UNWIND: readonly number[] = [14, 15];

/** `methodName@pc` for each step, which is what a diff of two traces has to read out. */
function at(methodName: string, offsets: readonly number[]): readonly string[] {
  return offsets.map((offset) => `${methodName}@${String(offset)}`);
}

const FACTORIAL_TRACE: readonly string[] = [
  ...at('main', [0, 1]),
  ...at('factorial', DESCEND), // n = 4
  ...at('factorial', DESCEND), // n = 3
  ...at('factorial', DESCEND), // n = 2
  ...at('factorial', BASE_CASE), // n = 1, returns 1
  ...at('factorial', UNWIND), // 1 × 2
  ...at('factorial', UNWIND), // 2 × 3
  ...at('factorial', UNWIND), // 6 × 4
  ...at('main', [4, 5]),
  // The run ends on a snapshot with no frame left at all.
  'done',
];

/** Operand stack of the top frame wherever control changes hands. */
const FACTORIAL_HANDOVERS: readonly (readonly [string, readonly number[]])[] = [
  ['invokestatic', [4]], // main hands 4 over
  ['invokestatic', [4, 3]], // factorial(4) keeps n and passes n − 1
  ['invokestatic', [3, 2]],
  ['invokestatic', [2, 1]],
  ['ireturn', [1]], // the base case answers 1
  ['ireturn', [2]], // 1 × 2
  ['ireturn', [6]], // 2 × 3
  ['ireturn', [24]], // 6 × 4
  ['return', []], // main stores the result and is done
];

const HANDOVER_MNEMONICS: ReadonlySet<string> = new Set(['invokestatic', 'ireturn', 'return']);

describe('execute — the whole Factorial run, step by step', () => {
  const snapshots = runExample('Factorial.class', 'main');

  it('visits the instructions javap lists, in the order the recursion needs them', () => {
    const trace = snapshots.map((snapshot) => {
      const frame = snapshot.callStack.at(-1);
      return frame === undefined ? 'done' : `${frame.methodName}@${String(frame.pc)}`;
    });

    expect(trace).toEqual(FACTORIAL_TRACE);
  });

  it('hands the same values over at every call and every return', () => {
    const handovers = snapshots
      .filter((snapshot) => HANDOVER_MNEMONICS.has(snapshot.currentInstruction?.mnemonic ?? ''))
      .map((snapshot): readonly [string, readonly number[]] => [
        snapshot.currentInstruction?.mnemonic ?? '',
        snapshot.callStack.at(-1)?.operandStack ?? [],
      ]);

    expect(handovers).toEqual(FACTORIAL_HANDOVERS);
  });

  it('keeps the pc of a waiting frame on the instruction the call returns to', () => {
    // Every frame below the top stands at pc 14, the `imul` that consumes the returned value.
    const waiting = snapshots.flatMap((snapshot) =>
      snapshot.callStack.slice(1, -1).map((frame) => frame.pc),
    );

    expect(new Set(waiting)).toEqual(new Set([14]));
    expect(waiting.length).toBeGreaterThan(0);
  });
});
