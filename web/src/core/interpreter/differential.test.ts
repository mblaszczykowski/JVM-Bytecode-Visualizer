import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseClassFile } from '../classfile';
import { execute, NO_HEAP, type HeapObject, type Snapshot } from './index';
import { expectCompleted, lastFrameOf, localValue } from './__fixtures__/expect-execution';

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

describe('execute: differential against the real JVM', () => {
  const examples = readManifest();

  it.each(examples)(
    '$id: $resultVariable equals $expectedResult',
    ({ classFile, entryMethod, resultVariable, expectedResult }) => {
      const snapshots = runExample(classFile, entryMethod);
      const entryFrame = lastFrameOf(snapshots, entryMethod);

      expect(localValue(entryFrame, resultVariable)).toBe(expectedResult);
      expect(snapshots.length).toBeGreaterThanOrEqual(30);
      expect(snapshots.length).toBeLessThanOrEqual(2_000);
    },
  );
});

const PROGRAMS = new URL('./__fixtures__/programs/', import.meta.url);
const DISASSEMBLER_FIXTURES = new URL('../disassembler/__fixtures__/', import.meta.url);

interface DifferentialProgram {
  readonly name: string;
  readonly directory: URL;
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
  { name: 'StackOps', directory: PROGRAMS, covers: 'dup, dup_x2 and dup2' },
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

function expectedOutput({ name, directory }: DifferentialProgram): readonly string[] {
  const lines = readFileSync(new URL(`${name}.stdout.txt`, directory), 'utf8').split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function runProgram({ name, directory }: DifferentialProgram): readonly Snapshot[] {
  const bytes = new Uint8Array(readFileSync(new URL(`${name}.class`, directory)));
  return expectCompleted(execute(parseClassFile(bytes.buffer), { maxSteps: 200_000 })).snapshots;
}

describe('execute: console output, differential against the real JVM', () => {
  it.each(PROGRAMS_UNDER_TEST)('$name prints what java printed ($covers)', (program) => {
    const snapshots = runProgram(program);

    expect(snapshots.at(-1)?.consoleOutput).toEqual(expectedOutput(program));
  });

  it.each(PROGRAMS_UNDER_TEST)('$name only ever appends to the console', (program) => {
    const snapshots = runProgram(program);
    const final = expectedOutput(program);

    for (const snapshot of snapshots) {
      const output = snapshot.consoleOutput;
      const completed = output.slice(0, -1);
      const open = output.at(-1);

      expect(final.slice(0, completed.length)).toEqual([...completed]);
      if (open !== undefined) {
        expect(final[output.length - 1]?.startsWith(open)).toBe(true);
      }
    }
  });

  it('shares one console array across every step that prints nothing', () => {
    const snapshots = runProgram(BITS);
    const distinct = new Set(snapshots.map((snapshot) => snapshot.consoleOutput));
    const lines = snapshots.at(-1)?.consoleOutput.length ?? 0;

    expect(distinct.size).toBeLessThanOrEqual(lines + 2);
    expect(snapshots.length).toBeGreaterThan(distinct.size * 5);
  });
});

const BUBBLE_SORT_INPUT: readonly number[] = [5, 3, 4, 1, 2];

function lastLiveHeap(snapshots: readonly Snapshot[]): readonly HeapObject[] {
  const live = [...snapshots].reverse().find((snapshot) => snapshot.callStack.length > 0);
  if (live === undefined) {
    throw new Error('the run has no snapshot with a frame');
  }
  return live.heap;
}

function arrayElementsAt(heap: readonly HeapObject[], handle: number): readonly number[] {
  const object = heap[handle];
  if (object?.kind !== 'int-array') {
    throw new Error(`no array at handle ${String(handle)}`);
  }
  return object.elements;
}

describe('execute: the array BubbleSort leaves on the heap', () => {
  const snapshots = runExample('BubbleSort.class', 'main');

  it('sorts the one array it allocates into ascending order', () => {
    const heap = lastLiveHeap(snapshots);

    expect(heap).toHaveLength(1);
    expect(heap[0]?.kind).toBe('int-array');
    expect(arrayElementsAt(heap, 0)).toEqual(
      [...BUBBLE_SORT_INPUT].sort((left, right) => left - right),
    );
  });

  it('starts out unsorted, so the sorting is what ordered the array', () => {
    const beforeSorting = snapshots.find(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'arraylength',
    );

    expect(arrayElementsAt(beforeSorting?.heap ?? NO_HEAP, 0)).toEqual(BUBBLE_SORT_INPUT);
  });

  it('needs a few hundred steps for five elements', () => {
    expect(snapshots.length).toBeGreaterThan(100);
    expect(snapshots.length).toBeLessThan(600);
  });
});

const DESCEND: readonly number[] = [0, 1, 2, 7, 8, 9, 10, 11];
const BASE_CASE: readonly number[] = [0, 1, 2, 5, 6];
const UNWIND: readonly number[] = [14, 15];

function at(methodName: string, offsets: readonly number[]): readonly string[] {
  return offsets.map((offset) => `${methodName}@${String(offset)}`);
}

const FACTORIAL_TRACE: readonly string[] = [
  ...at('main', [0, 1]),
  ...at('factorial', DESCEND),
  ...at('factorial', DESCEND),
  ...at('factorial', DESCEND),
  ...at('factorial', BASE_CASE),
  ...at('factorial', UNWIND),
  ...at('factorial', UNWIND),
  ...at('factorial', UNWIND),
  ...at('main', [4, 5]),
  'done',
];

const FACTORIAL_HANDOVERS: readonly (readonly [string, readonly number[]])[] = [
  ['invokestatic', [4]],
  ['invokestatic', [4, 3]],
  ['invokestatic', [3, 2]],
  ['invokestatic', [2, 1]],
  ['ireturn', [1]],
  ['ireturn', [2]],
  ['ireturn', [6]],
  ['ireturn', [24]],
  ['return', []],
];

const HANDOVER_MNEMONICS: ReadonlySet<string> = new Set(['invokestatic', 'ireturn', 'return']);

describe('execute: the Factorial run, step by step', () => {
  const snapshots = runExample('Factorial.class', 'main');

  it('visits the instructions javap lists, in recursion order', () => {
    const trace = snapshots.map((snapshot) => {
      const frame = snapshot.callStack.at(-1);
      return frame === undefined ? 'done' : `${frame.methodName}@${String(frame.pc)}`;
    });

    expect(trace).toEqual(FACTORIAL_TRACE);
  });

  it('passes the expected operand stack at every call and every return', () => {
    const handovers = snapshots
      .filter((snapshot) => HANDOVER_MNEMONICS.has(snapshot.currentInstruction?.mnemonic ?? ''))
      .map((snapshot): readonly [string, readonly number[]] => [
        snapshot.currentInstruction?.mnemonic ?? '',
        snapshot.callStack.at(-1)?.operandStack ?? [],
      ]);

    expect(handovers).toEqual(FACTORIAL_HANDOVERS);
  });

  it('keeps the pc of a waiting frame on the instruction the call returns to', () => {
    const waiting = snapshots.flatMap((snapshot) =>
      snapshot.callStack.slice(1, -1).map((frame) => frame.pc),
    );

    expect(new Set(waiting)).toEqual(new Set([14]));
    expect(waiting.length).toBeGreaterThan(0);
  });
});
