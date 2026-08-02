import { describe, expect, it } from 'vitest';

import { expectCompleted, expectVmError } from './__fixtures__/expect-execution';
import { ConstantPoolBuilder, syntheticClass } from './__fixtures__/synthetic-class';
import { MAX_HEAP_ELEMENTS, MAX_RECORDED_ELEMENTS } from './heap';
import { execute } from './interpreter';
import type { ArrayObject, ExecutionResult, Snapshot, ValueKind } from './types';

/**
 * The int-array subset: allocation, element access, the reference kind that tells a handle
 * apart from a number, and the structural sharing that keeps the heap history affordable.
 *
 * Programs are hand-written bytecode, so they can put an array where javac never would —
 * a negative length, an index past the end, a reference read as an int.
 */

const T_INT = 0x0a;

/**
 * Two-pass assembler for the programs below. `label` marks an offset, `branch` emits the
 * signed delta JVMS §6.5 wants (relative to the opcode byte, not to the operands). Bubble
 * sort alone has four branches over sixty bytes; hand-computed deltas would make the test a
 * puzzle about arithmetic rather than about arrays.
 */
type Piece = number | { readonly label: string } | { readonly opcode: number; readonly to: string };

function label(name: string): Piece {
  return { label: name };
}

function branch(opcode: number, to: string): Piece {
  return { opcode, to };
}

function assemble(pieces: readonly Piece[]): readonly number[] {
  const offsets = new Map<string, number>();
  let offset = 0;
  for (const piece of pieces) {
    if (typeof piece === 'number') {
      offset += 1;
    } else if ('label' in piece) {
      offsets.set(piece.label, offset);
    } else {
      offset += 3; // opcode + a two-byte signed delta
    }
  }

  const code: number[] = [];
  for (const piece of pieces) {
    if (typeof piece === 'number') {
      code.push(piece);
      continue;
    }
    if ('label' in piece) {
      continue;
    }
    const target = offsets.get(piece.to);
    if (target === undefined) {
      throw new Error(`branch to an undefined label: ${piece.to}`);
    }
    const delta = target - code.length;
    code.push(piece.opcode, (delta >> 8) & 0xff, delta & 0xff);
  }
  return code;
}

function run(code: readonly number[], maxLocals = 4): readonly Snapshot[] {
  return expectCompleted(
    execute(
      syntheticClass({ methods: [{ name: 'main', descriptor: '()V', code, maxLocals }] }),
      // Bubble sort over five elements is a few hundred instructions.
      { maxSteps: 5_000 },
    ),
  ).snapshots;
}

/** Runs `code` as a static `()I` method and returns what it left on the stack. */
function evaluate(code: readonly number[], maxLocals = 4): number | undefined {
  return expectCompleted(
    execute(syntheticClass({ methods: [{ name: 'main', descriptor: '()I', code, maxLocals }] })),
  ).returnValue;
}

function heapOf(snapshot: Snapshot | undefined): readonly ArrayObject[] {
  return snapshot?.heap ?? [];
}

function finalHeap(snapshots: readonly Snapshot[]): readonly ArrayObject[] {
  return heapOf(snapshots.at(-1));
}

function elementsAt(heap: readonly ArrayObject[], handle: number): readonly number[] {
  const array = heap[handle];
  if (array === undefined) {
    throw new Error(`the heap has no array at handle ${String(handle)}`);
  }
  return array.elements;
}

/** Kind of the top operand stack cell in the snapshot that follows the first `mnemonic`. */
function topKindAfter(snapshots: readonly Snapshot[], mnemonic: string): ValueKind | undefined {
  const step = snapshots.findIndex(
    (snapshot) => snapshot.currentInstruction?.mnemonic === mnemonic,
  );
  if (step < 0) {
    throw new Error(`the run never executes ${mnemonic}`);
  }
  return snapshots[step + 1]?.callStack.at(-1)?.operandKinds?.at(-1);
}

/** Every distinct `ArrayObject` the whole history holds — one per array, plus one per write. */
function distinctArrays(snapshots: readonly Snapshot[]): number {
  const seen = new Set<ArrayObject>();
  for (const snapshot of snapshots) {
    for (const array of heapOf(snapshot)) {
      seen.add(array);
    }
  }
  return seen.size;
}

/**
 * `int[] a = new int[5]; for (i…) a[i] = i + 1; for (i…) s += a[i]; return s;` — the shape
 * every array-walking loop javac emits, down to the `iinc` and the backward `goto`.
 */
const SUM_LOOP: readonly number[] = assemble([
  0x08, // iconst_5
  0xbc,
  T_INT, // newarray int
  0x4b, // astore_0            a
  0x03, // iconst_0
  0x3c, // istore_1            i = 0
  label('fill'),
  0x1b, // iload_1
  0x08, // iconst_5
  branch(0xa2, 'sum'), // if_icmpge sum
  0x2a, // aload_0
  0x1b, // iload_1
  0x1b, // iload_1
  0x04, // iconst_1
  0x60, // iadd
  0x4f, // iastore             a[i] = i + 1
  0x84,
  0x01,
  0x01, // iinc 1, 1
  branch(0xa7, 'fill'), // goto fill
  label('sum'),
  0x03, // iconst_0
  0x3d, // istore_2            s = 0
  0x03, // iconst_0
  0x3c, // istore_1            i = 0
  label('read'),
  0x1b, // iload_1
  0x08, // iconst_5
  branch(0xa2, 'done'), // if_icmpge done
  0x1c, // iload_2
  0x2a, // aload_0
  0x1b, // iload_1
  0x2e, // iaload
  0x60, // iadd
  0x3d, // istore_2            s += a[i]
  0x84,
  0x01,
  0x01, // iinc 1, 1
  branch(0xa7, 'read'), // goto read
  label('done'),
  0x1c, // iload_2
  0xac, // ireturn
]);

/**
 * Bubble sort over `{5, 3, 4, 1, 2}`, built element by element and then sorted in place.
 *
 *   for (i = 0; i < a.length - 1; i++)
 *     for (j = 0; j < a.length - 1 - i; j++)
 *       if (a[j] > a[j + 1]) { t = a[j]; a[j] = a[j + 1]; a[j + 1] = t; }
 *
 * Slots: 0 = a, 1 = i, 2 = j, 3 = t.
 */
const BUBBLE_SORT: readonly number[] = assemble([
  0x08, // iconst_5
  0xbc,
  T_INT, // newarray int
  0x4b, // astore_0
  ...fill(0, 5),
  ...fill(1, 3),
  ...fill(2, 4),
  ...fill(3, 1),
  ...fill(4, 2),
  0x03, // iconst_0
  0x3c, // istore_1            i = 0
  label('outer'),
  0x1b, // iload_1
  0x2a, // aload_0
  0xbe, // arraylength
  0x04, // iconst_1
  0x64, // isub
  branch(0xa2, 'done'), // if_icmpge done      i >= a.length - 1
  0x03, // iconst_0
  0x3d, // istore_2            j = 0
  label('inner'),
  0x1c, // iload_2
  0x2a, // aload_0
  0xbe, // arraylength
  0x04, // iconst_1
  0x64, // isub
  0x1b, // iload_1
  0x64, // isub
  branch(0xa2, 'nextOuter'), // if_icmpge      j >= a.length - 1 - i
  0x2a, // aload_0
  0x1c, // iload_2
  0x2e, // iaload              a[j]
  0x2a, // aload_0
  0x1c, // iload_2
  0x04, // iconst_1
  0x60, // iadd
  0x2e, // iaload              a[j + 1]
  branch(0xa4, 'nextInner'), // if_icmple      already in order
  0x2a, // aload_0
  0x1c, // iload_2
  0x2e, // iaload
  0x3e, // istore_3            t = a[j]
  0x2a, // aload_0
  0x1c, // iload_2
  0x2a, // aload_0
  0x1c, // iload_2
  0x04, // iconst_1
  0x60, // iadd
  0x2e, // iaload
  0x4f, // iastore             a[j] = a[j + 1]
  0x2a, // aload_0
  0x1c, // iload_2
  0x04, // iconst_1
  0x60, // iadd
  0x1d, // iload_3
  0x4f, // iastore             a[j + 1] = t
  label('nextInner'),
  0x84,
  0x02,
  0x01, // iinc 2, 1
  branch(0xa7, 'inner'), // goto inner
  label('nextOuter'),
  0x84,
  0x01,
  0x01, // iinc 1, 1
  branch(0xa7, 'outer'), // goto outer
  label('done'),
  0xb1, // return
]);

/** `a[index] = value` with a one-byte constant — the opening of the sort fixture. */
function fill(index: number, value: number): readonly number[] {
  return [0x2a, 0x03 + index, 0x10, value, 0x4f];
}

/** Two arrays, so a write to one can be watched leaving the other alone. */
const TWO_ARRAYS: readonly number[] = [
  0x05, //             iconst_2
  0xbc,
  T_INT, //     newarray int
  0x4b, //             astore_0        a
  0x05, //             iconst_2
  0xbc,
  T_INT, //     newarray int
  0x4c, //             astore_1        b
  0x2a,
  0x03,
  0x04,
  0x4f, // a[0] = 1
  0x00, //             nop
  0x00, //             nop
  0x2a,
  0x04,
  0x05,
  0x4f, // a[1] = 2
  0xb1, //             return
];

describe('execute — allocation and element access', () => {
  it('allocates a zero-filled array and pushes its length', () => {
    // iconst_3; newarray int; arraylength; ireturn
    expect(evaluate([0x06, 0xbc, T_INT, 0xbe, 0xac])).toBe(3);
  });

  it('allocates a zero length array, which is legal and simply empty', () => {
    const snapshots = run([0x03, 0xbc, T_INT, 0x4b, 0xb1]); // iconst_0; newarray; astore_0; return

    expect(elementsAt(finalHeap(snapshots), 0)).toEqual([]);
  });

  it('reads back what iastore wrote, leaving its neighbours at zero', () => {
    const snapshots = run([
      0x06,
      0xbc,
      T_INT, // iconst_3; newarray int
      0x4b, //          astore_0
      0x2a,
      0x04,
      0x10,
      42,
      0x4f, // a[1] = 42
      0xb1, //          return
    ]);

    expect(elementsAt(finalHeap(snapshots), 0)).toEqual([0, 42, 0]);
    // aload_0; iconst_1; iaload; ireturn appended to the same program
    expect(
      evaluate([0x06, 0xbc, T_INT, 0x4b, 0x2a, 0x04, 0x10, 42, 0x4f, 0x2a, 0x04, 0x2e, 0xac]),
    ).toBe(42);
  });

  it('gives every allocation its own handle and its own elements', () => {
    const snapshots = run(TWO_ARRAYS);
    const heap = finalHeap(snapshots);

    expect(heap).toHaveLength(2);
    expect(elementsAt(heap, 0)).toEqual([1, 2]);
    expect(elementsAt(heap, 1)).toEqual([0, 0]);
  });

  it('walks an array with a loop, filling it and summing it back to 15', () => {
    expect(evaluate([...SUM_LOOP], 3)).toBe(15);
  });

  it('sorts a hand-built array with a nested bubble-sort loop', () => {
    const snapshots = run(BUBBLE_SORT);

    // The sort really ran: by the first `arraylength` the fill is complete and unsorted.
    const sortBegins = snapshots.findIndex(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'arraylength',
    );

    expect(elementsAt(heapOf(snapshots[sortBegins]), 0)).toEqual([5, 3, 4, 1, 2]);
    expect(elementsAt(finalHeap(snapshots), 0)).toEqual([1, 2, 3, 4, 5]);
    expect(snapshots.length).toBeGreaterThan(100);
  });
});

describe('execute — value kinds', () => {
  it('marks a freshly allocated array as a reference and its length as an int', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0xbe, 0x3b, 0xb1]);

    expect(topKindAfter(snapshots, 'newarray')).toBe('ref');
    expect(topKindAfter(snapshots, 'arraylength')).toBe('int');
  });

  it('marks an element read with iaload as an int, not as the reference it came from', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0x4b, 0x2a, 0x03, 0x2e, 0x3c, 0xb1]);

    expect(topKindAfter(snapshots, 'iaload')).toBe('int');
  });

  it('reads a reference back as a reference after a round trip through a local slot', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0x4b, 0x2a, 0x57, 0xb1]);
    const stored = snapshots.find(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'aload_0',
    );

    expect(stored?.callStack.at(-1)?.localKinds?.[0]).toBe('ref');
    expect(topKindAfter(snapshots, 'aload_0')).toBe('ref');
  });

  it('keeps the kinds aligned with the values they describe', () => {
    const snapshots = run(BUBBLE_SORT);

    for (const snapshot of snapshots) {
      for (const frame of snapshot.callStack) {
        expect(frame.operandKinds).toHaveLength(frame.operandStack.length);
        expect(frame.localKinds).toHaveLength(frame.locals.length);
        // A slot holds a kind exactly when it holds a value.
        expect(frame.localKinds?.map((kind) => kind !== undefined)).toEqual(
          frame.locals.map((value) => value !== undefined),
        );
      }
    }
  });

  it('duplicates a reference as a reference', () => {
    // iconst_3; newarray int; dup; astore_0; arraylength; istore_1; return
    const snapshots = run([0x06, 0xbc, T_INT, 0x59, 0x4b, 0xbe, 0x3c, 0xb1]);

    expect(topKindAfter(snapshots, 'dup')).toBe('ref');
    expect(snapshots.at(-2)?.callStack.at(-1)?.locals).toEqual([0, 3, undefined, undefined]);
  });
});

describe('execute — heap snapshots', () => {
  it('freezes every array and every element list it hands out', () => {
    const snapshots = run(TWO_ARRAYS);

    for (const snapshot of snapshots) {
      const heap = heapOf(snapshot);
      expect(Object.isFrozen(heap)).toBe(true);
      for (const array of heap) {
        expect(Object.isFrozen(array)).toBe(true);
        expect(Object.isFrozen(array.elements)).toBe(true);
      }
    }

    const array = finalHeap(snapshots)[0];
    expect(() => Object.assign(array ?? {}, { length: 99 })).toThrow(TypeError);
  });

  it('hands consecutive snapshots the same frozen heap while nothing writes to it', () => {
    const snapshots = run(TWO_ARRAYS);
    const heaps = snapshots.map(heapOf);
    const objectsAt = (handle: number): number =>
      new Set(heaps.map((heap) => heap[handle]).filter((array) => array !== undefined)).size;

    // Five views for eighteen snapshots: empty, after each allocation, after each store.
    expect(heaps).toHaveLength(18);
    expect(new Set(heaps).size).toBe(5);
    // `a` is copied once when it is created and once per write; `b` is never written at all.
    expect(objectsAt(0)).toBe(3);
    expect(objectsAt(1)).toBe(1);
  });

  it('replaces only the array a store touched and shares its siblings', () => {
    const snapshots = run(TWO_ARRAYS);
    const step = snapshots.findIndex(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'iastore',
    );
    const before = heapOf(snapshots[step]);
    const after = heapOf(snapshots[step + 1]);

    expect(before[0]?.elements).toEqual([0, 0]);
    expect(after[0]?.elements).toEqual([1, 0]);
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('copies an array once per write rather than once per step', () => {
    const snapshots = expectCompleted(
      execute(
        syntheticClass({
          methods: [{ name: 'main', descriptor: '()I', code: [...SUM_LOOP], maxLocals: 3 }],
        }),
      ),
    ).snapshots;

    // One array, five elements written: six frozen copies for a run of eighty-odd steps.
    expect(distinctArrays(snapshots)).toBe(6);
    expect(snapshots.length).toBeGreaterThan(60);
  });

  it('keeps the copies of a long sort proportional to the writes, not to the steps', () => {
    const snapshots = run(BUBBLE_SORT);
    const writes = snapshots.filter(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'iastore',
    ).length;

    // The initial fill plus every swap; the array itself accounts for the remaining copy.
    expect(distinctArrays(snapshots)).toBe(writes + 1);
    expect(distinctArrays(snapshots)).toBeLessThan(snapshots.length / 4);
  });

  it('carries the final heap on the terminal snapshot, where no frame is left', () => {
    const snapshots = run(BUBBLE_SORT);
    const terminal = snapshots.at(-1);

    expect(terminal?.callStack).toEqual([]);
    expect(terminal?.heap?.[0]?.elements).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves the heap empty for a run that never allocates', () => {
    const snapshots = run([0x04, 0x3b, 0xb1]); // iconst_1; istore_0; return

    expect(snapshots.every((snapshot) => heapOf(snapshot).length === 0)).toBe(true);
    // Nothing changes, so every snapshot shares the one empty array.
    expect(new Set(snapshots.map(heapOf)).size).toBe(1);
  });
});

/**
 * The two memory bounds. Both exist because the failure they prevent is not an exception:
 * `new Array(n).fill(0)` past a certain `n` ends the process with a V8 fatal error, and a
 * history that outgrows the tab takes it down with no error at all.
 */
describe('execute — the limits on heap memory', () => {
  /** `ldc #1; newarray int; return`, with #1 holding `length`. */
  function allocate(length: number): ExecutionResult {
    const pool = new ConstantPoolBuilder();
    const index = pool.integer(length);
    return execute(
      syntheticClass({
        pool,
        methods: [{ name: 'main', descriptor: '()V', code: [0x12, index, 0xbc, T_INT, 0xb1] }],
      }),
    );
  }

  it('refuses an array larger than the whole heap instead of dying trying', () => {
    // The allocation a real `new int[Integer.MAX_VALUE]` compiles to. Reaching
    // `new Array(...).fill(0)` with it is an unrecoverable V8 abort, not a thrown error.
    const error = expectVmError(allocate(2_147_483_647));

    expect(error).toMatchObject({
      kind: 'out-of-memory',
      resource: 'heap',
      requested: 2_147_483_647,
      limit: MAX_HEAP_ELEMENTS,
      methodName: 'main',
    });
  });

  it('allocates right up to the limit', () => {
    expect(expectCompleted(allocate(MAX_HEAP_ELEMENTS)).kind).toBe('completed');
  });

  it('counts every array on the heap, not each one on its own', () => {
    // Two allocations of two thirds of the limit: neither is too large by itself.
    const two = Math.ceil((MAX_HEAP_ELEMENTS * 2) / 3);
    const pool = new ConstantPoolBuilder();
    const index = pool.integer(two);
    const error = expectVmError(
      execute(
        syntheticClass({
          pool,
          methods: [
            {
              name: 'main',
              descriptor: '()V',
              // ldc #1; newarray int; astore_0; ldc #1; newarray int; return
              code: [0x12, index, 0xbc, T_INT, 0x4b, 0x12, index, 0xbc, T_INT, 0xb1],
            },
          ],
        }),
      ),
    );

    expect(error).toMatchObject({ kind: 'out-of-memory', resource: 'heap' });
    expect((error as { requested: number }).requested).toBe(two * 2);
  });

  it('stops a run whose array writes outgrow the recording budget', () => {
    // A modest array written in a loop: no single allocation is large, but the history keeps
    // one copy of the array per write, so the cost is length x writes.
    const length = 100_000;
    const pool = new ConstantPoolBuilder();
    const index = pool.integer(length);
    const result = execute(
      syntheticClass({
        pool,
        methods: [
          {
            name: 'main',
            descriptor: '()V',
            code: assemble([
              0x12,
              index,
              0xbc,
              T_INT,
              0x4b, // a = new int[100000]
              label('loop'),
              0x2a,
              0x03,
              0x03,
              0x4f, // a[0] = 0
              branch(0xa7, 'loop'), // goto loop
            ]),
          },
        ],
      }),
      { maxSteps: 20_000 },
    );

    const error = expectVmError(result);
    expect(error).toMatchObject({
      kind: 'out-of-memory',
      resource: 'history',
      limit: MAX_RECORDED_ELEMENTS,
    });
    // It stopped on the budget, long before it stopped on the step limit.
    expect(result.snapshots.length).toBeLessThan(20_000);
  });

  it('leaves a run that never allocates untouched by either budget', () => {
    const snapshots = run([0x04, 0x3b, 0xb1]); // iconst_1; istore_0; return

    expect(snapshots).not.toHaveLength(0);
  });
});
