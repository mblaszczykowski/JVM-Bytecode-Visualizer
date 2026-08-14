import { describe, expect, it } from 'vitest';

import { expectCompleted, expectVmError } from './__fixtures__/expect-execution';
import { ConstantPoolBuilder, syntheticClass } from './__fixtures__/synthetic-class';
import { MAX_RECORDED_ELEMENTS } from './budget';
import { MAX_HEAP_ELEMENTS } from './heap';
import { execute } from './interpreter';
import type { ExecutionResult, HeapObject, Snapshot, ValueKind } from './types';

const T_INT = 0x0a;

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
      offset += 3;
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
    execute(syntheticClass({ methods: [{ name: 'main', descriptor: '()V', code, maxLocals }] }), {
      maxSteps: 5_000,
    }),
  ).snapshots;
}

function evaluate(code: readonly number[], maxLocals = 4): number | undefined {
  return expectCompleted(
    execute(syntheticClass({ methods: [{ name: 'main', descriptor: '()I', code, maxLocals }] })),
  ).returnValue;
}

function heapOf(snapshot: Snapshot | undefined): readonly HeapObject[] {
  return snapshot?.heap ?? NO_HEAP;
}

const NO_HEAP: readonly HeapObject[] = Object.freeze([]);

function finalHeap(snapshots: readonly Snapshot[]): readonly HeapObject[] {
  return heapOf(snapshots.at(-1));
}

function elementsAt(heap: readonly HeapObject[], handle: number): readonly number[] {
  const object = heap[handle];
  if (object?.kind !== 'int-array') {
    throw new Error(`the heap has no array at handle ${String(handle)}`);
  }
  return object.elements;
}

function topKindAfter(snapshots: readonly Snapshot[], mnemonic: string): ValueKind | undefined {
  const step = snapshots.findIndex(
    (snapshot) => snapshot.currentInstruction?.mnemonic === mnemonic,
  );
  if (step < 0) {
    throw new Error(`the run never executes ${mnemonic}`);
  }
  return snapshots[step + 1]?.callStack.at(-1)?.operandKinds.at(-1);
}

function distinctArrays(snapshots: readonly Snapshot[]): number {
  const seen = new Set<HeapObject>();
  for (const snapshot of snapshots) {
    for (const array of heapOf(snapshot)) {
      seen.add(array);
    }
  }
  return seen.size;
}

const SUM_LOOP: readonly number[] = assemble([
  0x08,
  0xbc,
  T_INT,
  0x4b,
  0x03,
  0x3c,
  label('fill'),
  0x1b,
  0x08,
  branch(0xa2, 'sum'),
  0x2a,
  0x1b,
  0x1b,
  0x04,
  0x60,
  0x4f,
  0x84,
  0x01,
  0x01,
  branch(0xa7, 'fill'),
  label('sum'),
  0x03,
  0x3d,
  0x03,
  0x3c,
  label('read'),
  0x1b,
  0x08,
  branch(0xa2, 'done'),
  0x1c,
  0x2a,
  0x1b,
  0x2e,
  0x60,
  0x3d,
  0x84,
  0x01,
  0x01,
  branch(0xa7, 'read'),
  label('done'),
  0x1c,
  0xac,
]);

const BUBBLE_SORT: readonly number[] = assemble([
  0x08,
  0xbc,
  T_INT,
  0x4b,
  ...fill(0, 5),
  ...fill(1, 3),
  ...fill(2, 4),
  ...fill(3, 1),
  ...fill(4, 2),
  0x03,
  0x3c,
  label('outer'),
  0x1b,
  0x2a,
  0xbe,
  0x04,
  0x64,
  branch(0xa2, 'done'),
  0x03,
  0x3d,
  label('inner'),
  0x1c,
  0x2a,
  0xbe,
  0x04,
  0x64,
  0x1b,
  0x64,
  branch(0xa2, 'nextOuter'),
  0x2a,
  0x1c,
  0x2e,
  0x2a,
  0x1c,
  0x04,
  0x60,
  0x2e,
  branch(0xa4, 'nextInner'),
  0x2a,
  0x1c,
  0x2e,
  0x3e,
  0x2a,
  0x1c,
  0x2a,
  0x1c,
  0x04,
  0x60,
  0x2e,
  0x4f,
  0x2a,
  0x1c,
  0x04,
  0x60,
  0x1d,
  0x4f,
  label('nextInner'),
  0x84,
  0x02,
  0x01,
  branch(0xa7, 'inner'),
  label('nextOuter'),
  0x84,
  0x01,
  0x01,
  branch(0xa7, 'outer'),
  label('done'),
  0xb1,
]);

function fill(index: number, value: number): readonly number[] {
  return [0x2a, 0x03 + index, 0x10, value, 0x4f];
}

const TWO_ARRAYS: readonly number[] = [
  0x05,
  0xbc,
  T_INT,
  0x4b,
  0x05,
  0xbc,
  T_INT,
  0x4c,
  0x2a,
  0x03,
  0x04,
  0x4f,
  0x00,
  0x00,
  0x2a,
  0x04,
  0x05,
  0x4f,
  0xb1,
];

describe('execute: allocation and element access', () => {
  it('allocates a zero-filled array and pushes its length', () => {
    expect(evaluate([0x06, 0xbc, T_INT, 0xbe, 0xac])).toBe(3);
  });

  it('allocates a zero-length array', () => {
    const snapshots = run([0x03, 0xbc, T_INT, 0x4b, 0xb1]);

    expect(elementsAt(finalHeap(snapshots), 0)).toEqual([]);
  });

  it('reads back what iastore wrote, leaving its neighbours at zero', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0x4b, 0x2a, 0x04, 0x10, 42, 0x4f, 0xb1]);

    expect(elementsAt(finalHeap(snapshots), 0)).toEqual([0, 42, 0]);
    expect(
      evaluate([0x06, 0xbc, T_INT, 0x4b, 0x2a, 0x04, 0x10, 42, 0x4f, 0x2a, 0x04, 0x2e, 0xac]),
    ).toBe(42);
  });

  it('gives every allocation its own handle and elements', () => {
    const snapshots = run(TWO_ARRAYS);
    const heap = finalHeap(snapshots);

    expect(heap).toHaveLength(2);
    expect(elementsAt(heap, 0)).toEqual([1, 2]);
    expect(elementsAt(heap, 1)).toEqual([0, 0]);
  });

  it('fills an array in a loop and sums it back to 15', () => {
    expect(evaluate([...SUM_LOOP], 3)).toBe(15);
  });

  it('sorts a hand-built array with a nested bubble-sort loop', () => {
    const snapshots = run(BUBBLE_SORT);

    const sortBegins = snapshots.findIndex(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'arraylength',
    );

    expect(elementsAt(heapOf(snapshots[sortBegins]), 0)).toEqual([5, 3, 4, 1, 2]);
    expect(elementsAt(finalHeap(snapshots), 0)).toEqual([1, 2, 3, 4, 5]);
    expect(snapshots.length).toBeGreaterThan(100);
  });
});

describe('execute: value kinds', () => {
  it('marks a freshly allocated array as a reference and its length as an int', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0xbe, 0x3b, 0xb1]);

    expect(topKindAfter(snapshots, 'newarray')).toBe('ref');
    expect(topKindAfter(snapshots, 'arraylength')).toBe('int');
  });

  it('marks an element read with iaload as an int', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0x4b, 0x2a, 0x03, 0x2e, 0x3c, 0xb1]);

    expect(topKindAfter(snapshots, 'iaload')).toBe('int');
  });

  it('keeps the ref kind across a round trip through a local slot', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0x4b, 0x2a, 0x57, 0xb1]);
    const stored = snapshots.find(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'aload_0',
    );

    expect(stored?.callStack.at(-1)?.localKinds[0]).toBe('ref');
    expect(topKindAfter(snapshots, 'aload_0')).toBe('ref');
  });

  it('keeps the kind arrays the same length as the values they describe', () => {
    const snapshots = run(BUBBLE_SORT);

    for (const snapshot of snapshots) {
      for (const frame of snapshot.callStack) {
        expect(frame.operandKinds).toHaveLength(frame.operandStack.length);
        expect(frame.operandOrigins).toHaveLength(frame.operandStack.length);
        expect(frame.localKinds).toHaveLength(frame.locals.length);
        expect(frame.localOrigins).toHaveLength(frame.locals.length);
        expect(frame.localNames).toHaveLength(frame.locals.length);
        expect(frame.localKinds.map((kind) => kind !== undefined)).toEqual(
          frame.locals.map((value) => value !== undefined),
        );
      }
    }
  });

  it('dup keeps the ref kind', () => {
    const snapshots = run([0x06, 0xbc, T_INT, 0x59, 0x4b, 0xbe, 0x3c, 0xb1]);

    expect(topKindAfter(snapshots, 'dup')).toBe('ref');
    expect(snapshots.at(-2)?.callStack.at(-1)?.locals).toEqual([0, 3, undefined, undefined]);
  });
});

describe('execute: heap snapshots', () => {
  it('freezes every array and every element list on the heap', () => {
    const snapshots = run(TWO_ARRAYS);

    for (const snapshot of snapshots) {
      const heap = heapOf(snapshot);
      expect(Object.isFrozen(heap)).toBe(true);
      for (const object of heap) {
        expect(Object.isFrozen(object)).toBe(true);
        expect(object.kind).toBe('int-array');
        expect(Object.isFrozen(elementsAt(heap, heap.indexOf(object)))).toBe(true);
      }
    }

    const array = finalHeap(snapshots)[0];
    expect(() => Object.assign(array ?? {}, { length: 99 })).toThrow(TypeError);
  });

  it('shares one frozen heap across consecutive snapshots while nothing writes', () => {
    const snapshots = run(TWO_ARRAYS);
    const heaps = snapshots.map(heapOf);
    const objectsAt = (handle: number): number =>
      new Set(heaps.map((heap) => heap[handle]).filter((array) => array !== undefined)).size;

    expect(heaps).toHaveLength(18);
    expect(new Set(heaps).size).toBe(5);
    expect(objectsAt(0)).toBe(3);
    expect(objectsAt(1)).toBe(1);
  });

  it('replaces only the array a store wrote to, sharing the rest', () => {
    const snapshots = run(TWO_ARRAYS);
    const step = snapshots.findIndex(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'iastore',
    );
    const before = heapOf(snapshots[step]);
    const after = heapOf(snapshots[step + 1]);

    expect(elementsAt(before, 0)).toEqual([0, 0]);
    expect(elementsAt(after, 0)).toEqual([1, 0]);
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

    expect(distinctArrays(snapshots)).toBe(6);
    expect(snapshots.length).toBeGreaterThan(60);
  });

  it('keeps the copies of a long sort proportional to its writes', () => {
    const snapshots = run(BUBBLE_SORT);
    const writes = snapshots.filter(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'iastore',
    ).length;

    expect(distinctArrays(snapshots)).toBe(writes + 1);
    expect(distinctArrays(snapshots)).toBeLessThan(snapshots.length / 4);
  });

  it('carries the final heap on the terminal snapshot', () => {
    const snapshots = run(BUBBLE_SORT);
    const terminal = snapshots.at(-1);

    expect(terminal?.callStack).toEqual([]);
    expect(elementsAt(heapOf(terminal), 0)).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves the heap empty for a run that never allocates', () => {
    const snapshots = run([0x04, 0x3b, 0xb1]);

    expect(snapshots.every((snapshot) => heapOf(snapshot).length === 0)).toBe(true);
    expect(new Set(snapshots.map(heapOf)).size).toBe(1);
  });
});

describe('execute: heap memory limits', () => {
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

  it('refuses an array larger than the heap limit', () => {
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

  it('sums every array on the heap against the limit', () => {
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
              0x4b,
              label('loop'),
              0x2a,
              0x03,
              0x03,
              0x4f,
              branch(0xa7, 'loop'),
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
    expect(result.snapshots.length).toBeLessThan(20_000);
  });
});
