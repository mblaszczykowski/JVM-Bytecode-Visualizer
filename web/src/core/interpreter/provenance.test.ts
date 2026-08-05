import { describe, expect, it } from 'vitest';

import { execute } from './interpreter';
import type { Snapshot, StackFrame } from './types';

import { expectCompleted } from './__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
} from './__fixtures__/synthetic-class';

/**
 * Provenance: which step produced each value the machine is holding.
 *
 * The property under test is not "the number is plausible" but "the number is the step whose
 * instruction actually produced this cell". That distinction is the whole point — a cheaper
 * implementation that diffed consecutive snapshots by value would agree with every assertion
 * here except `keeps the step of the operation, not of an operand it happens to equal`, which
 * is exactly the case a reader would be misled by.
 */

const ICONST_0 = 0x03;
const ICONST_1 = 0x04;
const ICONST_2 = 0x05;
const ICONST_3 = 0x06;
const BIPUSH = 0x10;
const ILOAD_0 = 0x1a;
const ISTORE_0 = 0x3b;
const ISTORE_1 = 0x3c;
const IADD = 0x60;
const IRETURN = 0xac;

function run(code: readonly number[], maxLocals = 4): readonly Snapshot[] {
  const classFile = syntheticClass({
    methods: [{ name: 'main', descriptor: '()I', code, maxLocals }],
  });
  return expectCompleted(execute(classFile)).snapshots;
}

/** The frame as it stands at `step`, i.e. before that step's instruction runs. */
function frameAt(snapshots: readonly Snapshot[], step: number): StackFrame {
  const frame = snapshots[step]?.callStack.at(-1);
  if (frame === undefined) {
    throw new Error(`no frame at step ${String(step)}`);
  }
  return frame;
}

describe('operand stack provenance', () => {
  it('stamps a pushed constant with the step that pushed it', () => {
    // 0: iconst_1   1: iconst_2   2: iadd   3: ireturn
    const snapshots = run([ICONST_1, ICONST_2, IADD, IRETURN]);

    // Before `iadd` both constants are on the stack, each from its own step.
    expect(frameAt(snapshots, 2).operandOrigins).toEqual([0, 1]);
  });

  it('keeps the step of the operation, not of an operand it happens to equal', () => {
    // 0: iconst_2   1: iconst_0   2: iadd   3: ireturn
    // 2 + 0 = 2, so the result is bit-for-bit the value already at the bottom of the stack.
    // Nothing about the numbers changed; only the step that produced them did.
    const snapshots = run([ICONST_2, ICONST_0, IADD, IRETURN]);

    const beforeAdd = frameAt(snapshots, 2);
    expect(beforeAdd.operandStack).toEqual([2, 0]);
    expect(beforeAdd.operandOrigins).toEqual([0, 1]);

    const afterAdd = frameAt(snapshots, 3);
    expect(afterAdd.operandStack).toEqual([2]);
    expect(afterAdd.operandOrigins).toEqual([2]);
  });

  it('pops the origin with the value, so the stack never carries a stale one', () => {
    // 0: iconst_1   1: iconst_2   2: iadd   3: iconst_3   4: iadd   5: ireturn
    const snapshots = run([ICONST_1, ICONST_2, IADD, ICONST_3, IADD, IRETURN]);

    expect(frameAt(snapshots, 3).operandOrigins).toEqual([2]);
    expect(frameAt(snapshots, 4).operandOrigins).toEqual([2, 3]);
    expect(frameAt(snapshots, 5).operandOrigins).toEqual([4]);
  });

  it('aligns one origin with every cell, at every step', () => {
    const snapshots = run([ICONST_1, ICONST_2, IADD, ICONST_3, IADD, IRETURN]);

    for (const snapshot of snapshots) {
      for (const frame of snapshot.callStack) {
        expect(frame.operandOrigins).toHaveLength(frame.operandStack.length);
      }
    }
  });
});

describe('local slot provenance', () => {
  it('stamps a slot with the step that stored into it', () => {
    // 0: bipush 7   2: istore_0   3: iload_0   4: ireturn
    const snapshots = run([BIPUSH, 7, ISTORE_0, ILOAD_0, IRETURN]);

    // The store is the instruction at step 1; slot 0 dates from there.
    expect(frameAt(snapshots, 2).localOrigins?.[0]).toBe(1);
  });

  it('moves the origin forward when the slot is written again', () => {
    // 0: iconst_1  1: istore_0  2: iconst_2  3: istore_0  4: iload_0  5: ireturn
    const snapshots = run([ICONST_1, ISTORE_0, ICONST_2, ISTORE_0, ILOAD_0, IRETURN]);

    expect(frameAt(snapshots, 2).localOrigins?.[0]).toBe(1);
    expect(frameAt(snapshots, 4).localOrigins?.[0]).toBe(3);
  });

  it('leaves an uninitialised slot without an origin', () => {
    // 0: iconst_1  1: istore_1  2: iconst_0  3: ireturn — slot 0 is never written.
    const snapshots = run([ICONST_1, ISTORE_1, ICONST_0, IRETURN]);

    const frame = frameAt(snapshots, 2);
    expect(frame.locals[0]).toBeUndefined();
    expect(frame.localOrigins?.[0]).toBeUndefined();
    // ...while the slot that was written has one.
    expect(frame.localOrigins?.[1]).toBe(1);
  });
});

describe('provenance across a call', () => {
  it('dates a callee argument from the invoke rather than from the callee', () => {
    const pool = new ConstantPoolBuilder();
    const twice = pool.methodref(SYNTHETIC_CLASS_NAME, 'twice', '(I)I');
    const classFile = syntheticClass({
      pool,
      methods: [
        // iconst_3; invokestatic twice; ireturn
        { name: 'main', descriptor: '()I', code: [ICONST_3, 0xb8, 0x00, twice, IRETURN] },
        // iload_0; iload_0; iadd; ireturn
        { name: 'twice', descriptor: '(I)I', code: [ILOAD_0, ILOAD_0, IADD, IRETURN] },
      ],
    });

    const snapshots = expectCompleted(execute(classFile)).snapshots;
    // The first snapshot holding two frames is the callee standing on its first instruction.
    const entered = snapshots.findIndex((snapshot) => snapshot.callStack.length === 2);
    const callee = snapshots[entered]?.callStack[1];

    expect(callee?.locals[0]).toBe(3);
    // The invoke is the step before that — the argument was written by the call, not by `twice`.
    expect(callee?.localOrigins?.[0]).toBe(entered - 1);
  });

  it('dates a returned value from the return, on the caller stack', () => {
    const pool = new ConstantPoolBuilder();
    const one = pool.methodref(SYNTHETIC_CLASS_NAME, 'one', '()I');
    const classFile = syntheticClass({
      pool,
      methods: [
        { name: 'main', descriptor: '()I', code: [0xb8, 0x00, one, IRETURN] },
        { name: 'one', descriptor: '()I', code: [ICONST_1, IRETURN] },
      ],
    });

    const snapshots = expectCompleted(execute(classFile)).snapshots;
    const returned = snapshots.findIndex(
      (snapshot, step) =>
        step > 0 &&
        snapshot.callStack.length === 1 &&
        snapshot.callStack[0]?.operandStack.length === 1,
    );
    const caller = snapshots[returned]?.callStack[0];

    // The `ireturn` inside the callee is what put the value on the caller's stack.
    expect(caller?.operandStack).toEqual([1]);
    expect(caller?.operandOrigins?.[0]).toBe(returned - 1);
  });
});
