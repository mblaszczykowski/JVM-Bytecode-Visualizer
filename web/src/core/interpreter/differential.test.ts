import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { execute, parseClassFile, type HeapObject, type Snapshot } from '../index';
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
 * The other half of the differential suite: programs compiled with `javac -g` and run on the
 * real `java`, with the whole of their standard output committed next to them. Every value a
 * program computes is printed, so comparing the console line for line pins the arithmetic, the
 * switch dispatch, the `wide` forms and the printing itself against the reference
 * implementation — nothing here is an expectation anyone wrote by hand.
 *
 * `WideOps` lives with the disassembler fixtures because `javap` parity is what it was built
 * for; it is int-only and runnable, so it doubles as the differential case for `wide`.
 */
const PROGRAMS = new URL('./__fixtures__/programs/', import.meta.url);
const DISASSEMBLER_FIXTURES = new URL('../disassembler/__fixtures__/', import.meta.url);

interface DifferentialProgram {
  readonly name: string;
  readonly directory: URL;
  /** What the program exercises, so a failure names the feature and not just the file. */
  readonly covers: string;
}

const BITS: DifferentialProgram = {
  name: 'Bits',
  directory: PROGRAMS,
  covers: 'shifts, bitwise logic and narrowing casts',
};

const PROGRAMS_UNDER_TEST: readonly DifferentialProgram[] = [
  BITS,
  { name: 'Switches', directory: PROGRAMS, covers: 'tableswitch and lookupswitch' },
  { name: 'MathOps', directory: PROGRAMS, covers: 'the java.lang.Math intrinsics' },
  { name: 'Console', directory: PROGRAMS, covers: 'every println and print overload' },
  {
    name: 'Instances',
    directory: PROGRAMS,
    covers: 'new, constructors, instance fields and methods, areturn and reference identity',
  },
  {
    name: 'Exceptions',
    directory: PROGRAMS,
    covers: 'the exception table, handler matching, unwinding, finally and athrow',
  },
  { name: 'WideOps', directory: DISASSEMBLER_FIXTURES, covers: 'the wide prefix' },
];

/** Lines of a text file, without the empty string a trailing newline leaves behind. */
function expectedOutput({ name, directory }: DifferentialProgram): readonly string[] {
  const lines = readFileSync(new URL(`${name}.stdout.txt`, directory), 'utf8').split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function runProgram({ name, directory }: DifferentialProgram): readonly Snapshot[] {
  const bytes = new Uint8Array(readFileSync(new URL(`${name}.class`, directory)));
  // These programs print hundreds of lines, which takes more steps than the UI default.
  return expectCompleted(execute(parseClassFile(bytes.buffer), { maxSteps: 200_000 })).snapshots;
}

describe('execute — console output, differential against the real JVM', () => {
  it.each(PROGRAMS_UNDER_TEST)('$name prints what java printed ($covers)', (program) => {
    const snapshots = runProgram(program);

    expect(snapshots.at(-1)?.consoleOutput).toEqual(expectedOutput(program));
  });

  it.each(PROGRAMS_UNDER_TEST)('$name only ever appends to the console', (program) => {
    const snapshots = runProgram(program);
    const final = expectedOutput(program);

    for (const snapshot of snapshots) {
      const output = snapshot.consoleOutput ?? [];
      // Whatever has been printed by a given step is what the program ends up printing, cut
      // short: the completed lines are a prefix of the final ones, and the line still open is
      // a prefix of the line it will become.
      const completed = output.slice(0, -1);
      const open = output.at(-1);

      expect(final.slice(0, completed.length)).toEqual([...completed]);
      if (open !== undefined) {
        expect(final[output.length - 1]?.startsWith(open)).toBe(true);
      }
    }
  });

  it('hands the same console array to every step that prints nothing', () => {
    const snapshots = runProgram(BITS);
    const distinct = new Set(snapshots.map((snapshot) => snapshot.consoleOutput));
    const lines = snapshots.at(-1)?.consoleOutput?.length ?? 0;

    // One array per write, plus the empty one every step before the first of them shares —
    // not one array per step, which is what copying the output on every step would cost.
    expect(distinct.size).toBeLessThanOrEqual(lines + 2);
    expect(snapshots.length).toBeGreaterThan(distinct.size * 5);
  });
});

/**
 * `expectedResult` only covers `a[0]`, and a[0] alone would also be 1 if the sort had stopped
 * after moving the smallest value to the front. The array on the heap is the rest of the
 * proof: same five values, all of them in order.
 */
const BUBBLE_SORT_INPUT: readonly number[] = [5, 3, 4, 1, 2];

/** The heap of the last snapshot that still has a frame — the run's final object graph. */
function lastLiveHeap(snapshots: readonly Snapshot[]): readonly HeapObject[] {
  const live = [...snapshots].reverse().find((snapshot) => snapshot.callStack.length > 0);
  if (live === undefined) {
    throw new Error('the run has no snapshot with a frame');
  }
  return live.heap ?? [];
}

/** Elements of the array at `handle`; the examples here allocate nothing but arrays. */
function arrayElementsAt(heap: readonly HeapObject[], handle: number): readonly number[] {
  const object = heap[handle];
  if (object?.kind !== 'int-array') {
    throw new Error(`no array at handle ${String(handle)}`);
  }
  return object.elements;
}

describe('execute — the array BubbleSort leaves behind', () => {
  const snapshots = runExample('BubbleSort.class', 'main');

  it('sorts the one array it allocates into ascending order', () => {
    const heap = lastLiveHeap(snapshots);

    // `newarray` runs once, so a second object would mean the run took a route of its own.
    expect(heap).toHaveLength(1);
    expect(heap[0]?.kind).toBe('int-array');
    // Sorted ascending and no value invented or lost on the way.
    expect(arrayElementsAt(heap, 0)).toEqual(
      [...BUBBLE_SORT_INPUT].sort((left, right) => left - right),
    );
  });

  it('starts out unsorted, so the sort is what put the array in order', () => {
    // By the first `arraylength` the initialiser is complete and the loops have not begun.
    const beforeSorting = snapshots.find(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'arraylength',
    );

    expect(arrayElementsAt(beforeSorting?.heap ?? [], 0)).toEqual(BUBBLE_SORT_INPUT);
  });

  it('needs a few hundred steps for five elements — long enough to scrub, short to replay', () => {
    expect(snapshots.length).toBeGreaterThan(100);
    expect(snapshots.length).toBeLessThan(600);
  });
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
