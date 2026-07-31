import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { AccessFlag, parseClassFile, type ClassFile } from '../classfile';
import { OPCODES } from '../disassembler';
import {
  expectCompleted,
  expectVmError,
  lastFrameOf,
  localValue,
  maxCallStackDepth,
} from './__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
} from './__fixtures__/synthetic-class';
import { EXECUTABLE_OPCODES, execute, findEntryMethod, isEntryMethod } from './interpreter';
import type { Snapshot, StackFrame } from './types';

/**
 * Bytecode of the fixtures used below, from `javap -c -p` (the full dump lives in
 * `../classfile/__fixtures__/Factorial.javap.txt`):
 *
 *   main([Ljava/lang/String;)V         factorial(I)I
 *      0: iconst_4                        0: iload_0        7: iload_0
 *      1: invokestatic factorial          1: iconst_1       8: iload_0
 *      4: istore_1        // result       2: if_icmpgt 7    9: iconst_1
 *      5: return                          5: iconst_1      10: isub
 *                                         6: ireturn       11: invokestatic factorial
 *   LineNumberTable main: 0→15, 5→16                       14: imul
 *   LineNumberTable factorial: 0→19, 5→20, 7→22            15: ireturn
 */
const FACTORIAL_CLASS = new URL('../classfile/__fixtures__/Factorial.class', import.meta.url);
const GCD_CLASS = new URL('../../../public/examples/Gcd.class', import.meta.url);

function parse(location: URL): ClassFile {
  // Copy into a fresh buffer: Node's Buffer can be a view into a shared pool.
  return parseClassFile(new Uint8Array(readFileSync(location)).buffer);
}

function runFactorial(): readonly Snapshot[] {
  return expectCompleted(execute(parse(FACTORIAL_CLASS))).snapshots;
}

/** Runs `code` as the body of a static `()I` entry method and returns what it puts on the stack. */
function evaluate(code: readonly number[], maxLocals = 4): number | undefined {
  const classFile = syntheticClass({
    methods: [{ name: 'main', descriptor: '()I', code, maxLocals }],
  });
  return expectCompleted(execute(classFile)).returnValue;
}

describe('execute — Factorial fixture', () => {
  it('runs main to completion without a return value', () => {
    const result = expectCompleted(execute(parse(FACTORIAL_CLASS)));

    expect(result.returnValue).toBeUndefined();
    expect(result.snapshots.length).toBeGreaterThanOrEqual(30);
    expect(result.snapshots.length).toBeLessThanOrEqual(200);
  });

  it('leaves 24 in the local named result', () => {
    const main = lastFrameOf(runFactorial(), 'main');

    expect(localValue(main, 'result')).toBe(24);
  });

  it('grows the call stack to exactly five frames (main plus factorial(4..1))', () => {
    const snapshots = runFactorial();

    expect(maxCallStackDepth(snapshots)).toBe(5);
    const deepest = snapshots.find((snapshot) => snapshot.callStack.length === 5);
    expect(deepest?.callStack.map((frame) => frame.methodName)).toEqual([
      'main',
      'factorial',
      'factorial',
      'factorial',
      'factorial',
    ]);
    expect(deepest?.callStack.map((frame) => frame.locals[0])).toEqual([undefined, 4, 3, 2, 1]);
  });

  it('starts with the state before the first instruction', () => {
    const first = runFactorial()[0];

    expect(first).toMatchObject({
      step: 0,
      sourceLine: 15,
      currentInstruction: { offset: 0, mnemonic: 'iconst_4' },
    });
    expect(first?.callStack).toHaveLength(1);
    expect(first?.callStack[0]).toMatchObject({
      methodName: 'main',
      methodDescriptor: '([Ljava/lang/String;)V',
      pc: 0,
      operandStack: [],
      locals: [undefined, undefined],
      // `result` only enters scope at its LocalVariableTable start_pc (5), where it is stored.
      localNames: ['args', undefined],
    });
    expect(lastFrameOf(runFactorial(), 'main')).toMatchObject({
      pc: 5,
      localNames: ['args', 'result'],
    });
  });

  it('ends with a terminal snapshot', () => {
    const snapshots = runFactorial();
    const terminal = snapshots.at(-1);

    expect(terminal).toEqual({
      step: snapshots.length - 1,
      callStack: [],
      heap: [],
      consoleOutput: [],
      externals: [],
    });
    expect(snapshots.at(-2)?.currentInstruction?.mnemonic).toBe('return');
  });

  it('keeps the caller pointing at the instruction after the call', () => {
    const entered = runFactorial().find((snapshot) => snapshot.callStack.length === 2);

    // main resumes at offset 4 (istore_1), the callee starts at 0 with the argument in slot 0.
    expect(entered?.callStack[0]).toMatchObject({ methodName: 'main', pc: 4, operandStack: [] });
    expect(entered?.callStack[1]).toMatchObject({ methodName: 'factorial', pc: 0, locals: [4] });
  });

  it('maps each pc to the last LineNumberTable entry that starts at or before it', () => {
    const snapshots = runFactorial();
    const lineAt = (methodName: string, pc: number): number | undefined =>
      snapshots.find(
        (snapshot) =>
          snapshot.currentInstruction?.offset === pc &&
          snapshot.callStack.at(-1)?.methodName === methodName,
      )?.sourceLine;

    expect(lineAt('main', 5)).toBe(16);
    expect(lineAt('factorial', 0)).toBe(19);
    expect(lineAt('factorial', 5)).toBe(20);
    expect(lineAt('factorial', 7)).toBe(22);
    // 14 has no entry of its own; the one at 7 is still in force.
    expect(lineAt('factorial', 14)).toBe(22);
  });

  it('never creates a frame for <init>', () => {
    const constructors = runFactorial().flatMap((snapshot) =>
      snapshot.callStack.filter((frame) => frame.methodName.startsWith('<')),
    );

    expect(constructors).toEqual([]);
  });

  it('freezes the whole history', () => {
    const snapshots = runFactorial();
    const snapshot = snapshots[0];
    const frame = snapshot?.callStack[0];

    expect(Object.isFrozen(snapshots)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot?.callStack)).toBe(true);
    expect(Object.isFrozen(snapshot?.currentInstruction)).toBe(true);
    expect(Object.isFrozen(snapshot?.currentInstruction?.operands)).toBe(true);
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame?.operandStack)).toBe(true);
    expect(Object.isFrozen(frame?.locals)).toBe(true);
    expect(Object.isFrozen(frame?.localNames)).toBe(true);
    expect(() => Object.assign(frame ?? {}, { pc: 99 })).toThrow(TypeError);
  });
});

describe('execute — Gcd fixture', () => {
  it('runs the while loop backwards through goto and leaves 21 in result', () => {
    const snapshots = expectCompleted(execute(parse(GCD_CLASS))).snapshots;
    const backwardJumps = snapshots.filter(
      (snapshot) =>
        snapshot.currentInstruction?.mnemonic === 'goto' &&
        (snapshot.currentInstruction.branchTarget ?? 0) < snapshot.currentInstruction.offset,
    );

    expect(localValue(lastFrameOf(snapshots, 'main'), 'result')).toBe(21);
    expect(maxCallStackDepth(snapshots)).toBe(2);
    // gcd(1071, 462) needs three iterations: 1071%462=147, 462%147=21, 147%21=0.
    expect(backwardJumps).toHaveLength(3);
  });
});

describe('execute — entry point', () => {
  it('returns the value of an ()I entry method', () => {
    expect(evaluate([0x08, 0xac])).toBe(5); // iconst_5; ireturn
  });

  it('runs the method named by options.entryMethod', () => {
    const classFile = syntheticClass({
      methods: [
        { name: 'main', descriptor: '()I', code: [0x03, 0xac] }, // iconst_0; ireturn
        { name: 'other', descriptor: '()I', code: [0x04, 0xac] }, // iconst_1; ireturn
      ],
    });

    expect(expectCompleted(execute(classFile, { entryMethod: 'other' })).returnValue).toBe(1);
  });

  it.each([
    { case: 'no such method', methods: [{ name: 'other', descriptor: '()V', code: [0xb1] }] },
    {
      case: 'not static',
      methods: [{ name: 'main', descriptor: '()V', code: [0xb1], accessFlags: 0 }],
    },
    { case: 'no Code attribute', methods: [{ name: 'main', descriptor: '()V' }] },
    {
      case: 'descriptor outside the supported set',
      methods: [{ name: 'main', descriptor: '(I)V', code: [0xb1] }],
    },
  ])('rejects an entry point that is $case', ({ methods }) => {
    const result = execute(syntheticClass({ methods }));

    expect(result.snapshots).toEqual([]);
    expect(expectVmError(result)).toEqual({
      kind: 'unsupported-call',
      target: `${SYNTHETIC_CLASS_NAME}.main`,
      offset: 0,
      methodName: 'main',
    });
  });

  it('reports the args slot of main as uninitialised when it is read', () => {
    const classFile = syntheticClass({
      methods: [
        // iload_0 on the String[] argument — no supported instruction can read a reference.
        { name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0x1a, 0x57, 0xb1] },
      ],
    });

    const error = expectVmError(execute(classFile));

    expect(error.kind).toBe('invalid-state');
    expect(error).toMatchObject({ offset: 0, methodName: 'main' });
    expect(error.kind === 'invalid-state' && error.message).toContain('uninitialised');
  });
});

describe('execute — instruction semantics', () => {
  it.each([
    { mnemonic: 'iconst_m1', opcode: 0x02, value: -1 },
    { mnemonic: 'iconst_0', opcode: 0x03, value: 0 },
    { mnemonic: 'iconst_1', opcode: 0x04, value: 1 },
    { mnemonic: 'iconst_2', opcode: 0x05, value: 2 },
    { mnemonic: 'iconst_3', opcode: 0x06, value: 3 },
    { mnemonic: 'iconst_4', opcode: 0x07, value: 4 },
    { mnemonic: 'iconst_5', opcode: 0x08, value: 5 },
  ])('pushes $value for $mnemonic', ({ opcode, value }) => {
    expect(evaluate([opcode, 0xac])).toBe(value);
  });

  it('reads bipush and sipush operands as signed', () => {
    expect(evaluate([0x10, 0xff, 0xac])).toBe(-1); // bipush -1
    expect(evaluate([0x10, 0x7f, 0xac])).toBe(127); // bipush 127
    expect(evaluate([0x11, 0x80, 0x00, 0xac])).toBe(-32_768); // sipush -32768
    expect(evaluate([0x11, 0x7f, 0xff, 0xac])).toBe(32_767); // sipush 32767
  });

  it('applies binary arithmetic to value1 <op> value2', () => {
    expect(evaluate([0x05, 0x06, 0x60, 0xac])).toBe(5); // 2 + 3
    expect(evaluate([0x06, 0x05, 0x64, 0xac])).toBe(1); // 3 - 2
    expect(evaluate([0x10, 0xf9, 0x05, 0x6c, 0xac])).toBe(-3); // -7 / 2, truncated toward zero
    expect(evaluate([0x10, 0xf9, 0x06, 0x70, 0xac])).toBe(-1); // -7 % 3
    expect(evaluate([0x08, 0x74, 0xac])).toBe(-5); // -(5)
  });

  it('wraps imul around 32 bits', () => {
    // 30000 * 30000 * 3 = 2_700_000_000, which does not fit in an int.
    const code = [0x11, 0x75, 0x30, 0x11, 0x75, 0x30, 0x68, 0x06, 0x68, 0xac];

    expect(evaluate(code)).toBe(-1_594_967_296);
  });

  it('duplicates and drops the top of the stack', () => {
    // iconst_5; dup; iadd; iconst_1; pop; ireturn
    expect(evaluate([0x08, 0x59, 0x60, 0x04, 0x57, 0xac])).toBe(10);
  });

  it('moves values through local slots', () => {
    // iconst_4; istore_0; iconst_5; istore_1; iload_0; iload_1; isub; ireturn
    expect(evaluate([0x07, 0x3b, 0x08, 0x3c, 0x1a, 0x1b, 0x64, 0xac])).toBe(-1);
    // iconst_1; istore_2; iconst_2; istore_3; iload_2; iload_3; iadd; ireturn
    expect(evaluate([0x04, 0x3d, 0x05, 0x3e, 0x1c, 0x1d, 0x60, 0xac])).toBe(3);
    // bipush 42; istore 4; iload 4; ireturn — the wide-index forms
    expect(evaluate([0x10, 0x2a, 0x36, 0x04, 0x15, 0x04, 0xac], 6)).toBe(42);
  });

  it('does nothing for nop', () => {
    expect(evaluate([0x00, 0x04, 0xac])).toBe(1);
  });

  it('adds a negative constant with iinc', () => {
    // bipush 10; istore_0; iinc 0, -3; iload_0; ireturn
    expect(evaluate([0x10, 0x0a, 0x3b, 0x84, 0x00, 0xfd, 0x1a, 0xac])).toBe(7);
  });

  it('runs a countdown loop built from iinc, ifle and a backward goto', () => {
    // sum = 0; for (i = 5; i > 0; i--) sum += i;  →  15
    const code = [
      0x10,
      0x05, //  0: bipush 5
      0x3b, //        2: istore_0        (i)
      0x03, //        3: iconst_0
      0x3c, //        4: istore_1        (sum)
      0x1a, //        5: iload_0
      0x9e,
      0x00,
      0x0d, // 6: ifle 19
      0x1b, //        9: iload_1
      0x1a, //       10: iload_0
      0x60, //       11: iadd
      0x3c, //       12: istore_1
      0x84,
      0x00,
      0xff, // 13: iinc 0, -1
      0xa7,
      0xff,
      0xf5, // 16: goto 5
      0x1b, //       19: iload_1
      0xac, //       20: ireturn
    ];

    expect(evaluate(code)).toBe(15);
  });

  it.each([
    { mnemonic: 'if_icmpeq', opcode: 0x9f, taken: [3, 3], skipped: [3, 4] },
    { mnemonic: 'if_icmpne', opcode: 0xa0, taken: [3, 4], skipped: [3, 3] },
    { mnemonic: 'if_icmplt', opcode: 0xa1, taken: [3, 4], skipped: [4, 3] },
    { mnemonic: 'if_icmpge', opcode: 0xa2, taken: [4, 3], skipped: [3, 4] },
    { mnemonic: 'if_icmpgt', opcode: 0xa3, taken: [4, 3], skipped: [3, 3] },
    { mnemonic: 'if_icmple', opcode: 0xa4, taken: [3, 3], skipped: [4, 3] },
  ])('branches on $mnemonic comparing value1 with value2', ({ opcode, taken, skipped }) => {
    // bipush v1; bipush v2; if_icmp<cond> 9; iconst_0; ireturn; iconst_1; ireturn
    const program = ([value1 = 0, value2 = 0]: readonly number[]): readonly number[] => [
      0x10,
      value1 & 0xff,
      0x10,
      value2 & 0xff,
      opcode,
      0x00,
      0x05,
      0x03,
      0xac,
      0x04,
      0xac,
    ];

    expect(evaluate(program(taken))).toBe(1);
    expect(evaluate(program(skipped))).toBe(0);
  });

  it.each([
    { mnemonic: 'ifeq', opcode: 0x99, taken: 0, skipped: 1 },
    { mnemonic: 'ifne', opcode: 0x9a, taken: 1, skipped: 0 },
    { mnemonic: 'iflt', opcode: 0x9b, taken: -1, skipped: 0 },
    { mnemonic: 'ifge', opcode: 0x9c, taken: 0, skipped: -1 },
    { mnemonic: 'ifgt', opcode: 0x9d, taken: 1, skipped: 0 },
    { mnemonic: 'ifle', opcode: 0x9e, taken: 0, skipped: 1 },
  ])('branches on $mnemonic comparing the value with zero', ({ opcode, taken, skipped }) => {
    // bipush v; if<cond> 7; iconst_0; ireturn; iconst_1; ireturn
    const program = (value: number): readonly number[] => [
      0x10,
      value & 0xff,
      opcode,
      0x00,
      0x05,
      0x03,
      0xac,
      0x04,
      0xac,
    ];

    expect(evaluate(program(taken))).toBe(1);
    expect(evaluate(program(skipped))).toBe(0);
  });

  it('passes arguments to a static call first-argument-first', () => {
    const pool = new ConstantPoolBuilder();
    const subtract = pool.methodref(SYNTHETIC_CLASS_NAME, 'subtract', '(II)I');
    const classFile = syntheticClass({
      pool,
      methods: [
        // bipush 10; iconst_3; invokestatic subtract; ireturn
        { name: 'main', descriptor: '()I', code: [0x10, 0x0a, 0x06, 0xb8, 0x00, subtract, 0xac] },
        // iload_0; iload_1; isub; ireturn — reversed arguments would return -7
        { name: 'subtract', descriptor: '(II)I', code: [0x1a, 0x1b, 0x64, 0xac] },
      ],
    });

    expect(expectCompleted(execute(classFile)).returnValue).toBe(7);
  });

  it('resumes the caller after a void call', () => {
    const pool = new ConstantPoolBuilder();
    const noop = pool.methodref(SYNTHETIC_CLASS_NAME, 'noop', '()V');
    const classFile = syntheticClass({
      pool,
      methods: [
        { name: 'main', descriptor: '()I', code: [0xb8, 0x00, noop, 0x04, 0xac] },
        { name: 'noop', descriptor: '()V', code: [0xb1] },
      ],
    });

    const result = expectCompleted(execute(classFile));

    expect(result.returnValue).toBe(1);
    expect(maxCallStackDepth(result.snapshots)).toBe(2);
  });
});

describe('execute — dispatch table', () => {
  it('executes exactly the opcodes the disassembler marks as supported', () => {
    const supported = [...OPCODES.values()]
      .filter((info) => info.kind === 'supported')
      .map((info) => info.opcode);

    expect([...EXECUTABLE_OPCODES].sort((a, b) => a - b)).toEqual(supported.sort((a, b) => a - b));
  });
});

describe('execute — local variable names', () => {
  /**
   * javac gives two disjoint scopes the same slot — the `i` of two sequential `for` loops is
   * the classic case — so a name is only valid inside the pc range of its entry.
   *
   *   0: iconst_1   1: istore_1   2: iconst_2   3: istore_1   4: iload_1   5: ireturn
   *   slot 1 is `a` on [0, 2) and `b` on [2, 6)
   */
  const SLOT_REUSE = syntheticClass({
    methods: [
      {
        name: 'main',
        descriptor: '()I',
        code: [0x04, 0x3c, 0x05, 0x3c, 0x1b, 0xac],
        maxLocals: 2,
        localVariableTable: [
          { startPc: 0, length: 2, name: 'a', descriptor: 'I', index: 1 },
          { startPc: 2, length: 4, name: 'b', descriptor: 'I', index: 1 },
        ],
      },
    ],
  });

  it('resolves a reused slot to the variable in scope at the current pc', () => {
    const { snapshots } = expectCompleted(execute(SLOT_REUSE));

    expect(
      snapshots
        .filter((snapshot) => snapshot.currentInstruction !== undefined)
        .map((snapshot) => [snapshot.callStack[0]?.pc, snapshot.callStack[0]?.localNames[1]]),
    ).toEqual([
      [0, 'a'],
      [1, 'a'],
      [2, 'b'],
      [3, 'b'],
      [4, 'b'],
      [5, 'b'],
    ]);
  });

  it('leaves a slot unnamed where no entry covers the pc', () => {
    const classFile = syntheticClass({
      methods: [
        {
          name: 'main',
          descriptor: '()I',
          code: [0x04, 0x3c, 0x1b, 0xac],
          maxLocals: 2,
          localVariableTable: [
            // Out of range for every pc of this method, and a slot outside max_locals.
            { startPc: 10, length: 4, name: 'later', descriptor: 'I', index: 1 },
            { startPc: 0, length: 4, name: 'outside', descriptor: 'I', index: 9 },
          ],
        },
      ],
    });

    const { snapshots } = expectCompleted(execute(classFile));

    expect(snapshots[0]?.callStack[0]?.localNames).toEqual([undefined, undefined]);
  });
});

describe('execute — snapshot allocation', () => {
  /**
   * `static int sum(int n) { return n <= 0 ? 0 : n + sum(n - 1); }`, called with `n`:
   *
   *   sum(I)I   0: iload_0   1: ifgt 6   4: iconst_0   5: ireturn
   *             6: iload_0   7: iload_0  8: iconst_1   9: isub
   *            10: invokestatic sum     13: iadd      14: ireturn
   */
  function recursiveSum(n: number): ClassFile {
    const pool = new ConstantPoolBuilder();
    const sum = pool.methodref(SYNTHETIC_CLASS_NAME, 'sum', '(I)I');
    return syntheticClass({
      pool,
      methods: [
        // sipush n; invokestatic sum; ireturn
        {
          name: 'main',
          descriptor: '()I',
          code: [0x11, (n >> 8) & 0xff, n & 0xff, 0xb8, 0x00, sum, 0xac],
        },
        {
          name: 'sum',
          descriptor: '(I)I',
          code: [
            0x1a,
            0x9d,
            0x00,
            0x05,
            0x03,
            0xac,
            0x1a,
            0x1a,
            0x04,
            0x64,
            0xb8,
            0x00,
            sum,
            0x60,
            0xac,
          ],
          maxLocals: 1,
        },
      ],
    });
  }

  function countFrames(snapshots: readonly Snapshot[]): number {
    const distinct = new Set<StackFrame>();
    for (const snapshot of snapshots) {
      for (const frame of snapshot.callStack) {
        distinct.add(frame);
      }
    }
    return distinct.size;
  }

  it('copies a frame per change, not per step, through a thousand nested calls', () => {
    const { snapshots, returnValue } = expectCompleted(execute(recursiveSum(1000)));
    const depth = maxCallStackDepth(snapshots);

    expect(returnValue).toBe(500_500);
    expect(depth).toBe(1_002);
    // Copying the whole stack every step allocated depth × steps ≈ 4.5 million frames here
    // (~2 GB) — enough to freeze the tab. Every frame is now copied once per change instead.
    expect(countFrames(snapshots)).toBeLessThan(3 * snapshots.length);
    expect(countFrames(snapshots)).toBeLessThan(snapshots.length * depth * 0.01);
  });

  it('shares the frozen frames of the call stack tail between consecutive snapshots', () => {
    const { snapshots } = expectCompleted(execute(recursiveSum(20)));
    const bottom = snapshots
      .map((snapshot) => snapshot.callStack[0])
      .filter((frame) => frame !== undefined);
    const shared = snapshots.filter(
      (snapshot, index) =>
        index > 0 && snapshot.callStack[0] === snapshots[index - 1]?.callStack[0],
    );

    // main changes only around its own three instructions; the recursion never touches it.
    expect(new Set(bottom).size).toBe(4);
    expect(shared.length).toBeGreaterThan(snapshots.length - 6);
  });

  it('never reuses a frame across two different calls at the same depth', () => {
    const pool = new ConstantPoolBuilder();
    const identity = pool.methodref(SYNTHETIC_CLASS_NAME, 'identity', '(I)I');
    const classFile = syntheticClass({
      pool,
      methods: [
        // iconst_1; invokestatic identity; iconst_2; invokestatic identity; iadd; ireturn
        {
          name: 'main',
          descriptor: '()I',
          code: [0x04, 0xb8, 0x00, identity, 0x05, 0xb8, 0x00, identity, 0x60, 0xac],
        },
        { name: 'identity', descriptor: '(I)I', code: [0x1a, 0xac], maxLocals: 1 },
      ],
    });

    const { snapshots, returnValue } = expectCompleted(execute(classFile));
    const callees = snapshots.flatMap((snapshot) => snapshot.callStack.slice(1));

    expect(returnValue).toBe(3);
    expect(callees.map((frame) => frame.locals[0])).toEqual([1, 1, 2, 2]);
    expect(new Set(callees).size).toBe(4);
  });

  it('still freezes every frame it reuses', () => {
    const { snapshots } = expectCompleted(execute(recursiveSum(5)));

    for (const snapshot of snapshots) {
      expect(Object.isFrozen(snapshot.callStack)).toBe(true);
      for (const frame of snapshot.callStack) {
        expect(Object.isFrozen(frame)).toBe(true);
        expect(Object.isFrozen(frame.operandStack)).toBe(true);
        expect(Object.isFrozen(frame.locals)).toBe(true);
        expect(Object.isFrozen(frame.localNames)).toBe(true);
      }
    }
  });
});

describe('findEntryMethod', () => {
  const runnable = { name: 'main', descriptor: '()I', code: [0x03, 0xac] };

  it('applies the rule execute() uses: static, with code, and a supported descriptor', () => {
    const classFile = syntheticClass({
      methods: [
        { name: 'abstract0', descriptor: '()V' },
        { name: 'instance', descriptor: '()V', code: [0xb1], accessFlags: AccessFlag.Public },
        { name: 'takesInt', descriptor: '(I)V', code: [0xb1] },
        runnable,
      ],
    });

    expect(classFile.methods.filter(isEntryMethod).map((method) => method.name)).toEqual(['main']);
    expect(findEntryMethod(classFile)?.method.name).toBe('main');
    expect(findEntryMethod(classFile, 'takesInt')).toBeUndefined();
  });

  it('accepts the descriptors of a main method and of a directly runnable method', () => {
    const descriptors = ['([Ljava/lang/String;)V', '()V', '()I'];

    for (const descriptor of descriptors) {
      const classFile = syntheticClass({
        methods: [{ name: 'run', descriptor, code: [0x03, 0x57, 0xb1] }],
      });

      expect(findEntryMethod(classFile, 'run')?.method.descriptor).toBe(descriptor);
    }
  });
});

/** A signed 4-byte value, the unit every operand of a switch table is made of (JVMS §6.5). */
function i4(value: number): readonly number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** The three arms every switch below jumps into: `return 1`, `return 2` and `return -1`. */
const SWITCH_ARMS: readonly number[] = [0x04, 0xac, 0x05, 0xac, 0x02, 0xac];

/**
 * A `tableswitch`, laid out by hand so its padding is exercised: the selector arrives through
 * a `bipush`, which puts the opcode at offset 2 and therefore leaves exactly one pad byte
 * before the 4-byte operands. Every offset below is relative to that opcode byte, and the
 * three arms start at 24, 26 and 28.
 */
function tableSwitchProgram(selector: number, defaultDelta = 26): readonly number[] {
  return [
    ...[0x10, selector], // 0: bipush selector
    ...[0xaa, 0x00], //     2: tableswitch, one pad byte
    ...i4(defaultDelta), //    default -> 28
    ...i4(1), //               low = 1
    ...i4(2), //               high = 2
    ...i4(22), //              case 1 -> 24
    ...i4(24), //              case 2 -> 26
    ...SWITCH_ARMS,
  ];
}

/** The same three answers through a `lookupswitch`, whose matches are far enough apart. */
function lookupSwitchProgram(selector: number): readonly number[] {
  return [
    ...[0x10, selector], // 0: bipush selector
    ...[0xab, 0x00], //     2: lookupswitch, one pad byte
    ...i4(30), //              default -> 32
    ...i4(2), //               npairs = 2
    ...i4(10),
    ...i4(26), //              case 10 -> 28
    ...i4(100_000),
    ...i4(28), //              case 100000 -> 30
    ...SWITCH_ARMS,
  ];
}

describe('execute — switch dispatch', () => {
  it.each([
    { selector: 1, answer: 1 },
    { selector: 2, answer: 2 },
    { selector: 0, answer: -1 },
    { selector: 3, answer: -1 },
    { selector: -1, answer: -1 },
  ])('tableswitch on $selector answers $answer', ({ selector, answer }) => {
    expect(evaluate(tableSwitchProgram(selector))).toBe(answer);
  });

  it.each([
    { selector: 10, answer: 1 },
    { selector: 11, answer: -1 },
    { selector: 0, answer: -1 },
  ])('lookupswitch on $selector answers $answer', ({ selector, answer }) => {
    expect(evaluate(lookupSwitchProgram(selector))).toBe(answer);
  });

  it('consumes the selector, leaving the operand stack as it found it', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()I', code: tableSwitchProgram(1) }],
    });
    const snapshots = expectCompleted(execute(classFile)).snapshots;
    const afterDispatch = snapshots[2];

    expect(afterDispatch?.currentInstruction?.mnemonic).toBe('iconst_1');
    expect(afterDispatch?.callStack[0]?.operandStack).toEqual([]);
  });

  it('rejects a switch arm that does not point at an instruction (JVMS §4.9.1)', () => {
    // A default branch into the pad byte of the switch itself is not a jump target.
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()I', code: tableSwitchProgram(9, 1) }],
    });

    expect(expectVmError(execute(classFile))).toMatchObject({
      kind: 'bad-branch-target',
      mnemonic: 'tableswitch',
      target: 3,
    });
  });
});

describe('execute — the wide prefix', () => {
  /** The prefix in front of the instruction it widens; slot 300 is out of reach without it. */
  function widened(opcode: number, ...operands: number[]): readonly number[] {
    return [0xc4, opcode, ...operands];
  }

  it('reads and writes a local above slot 255', () => {
    const code = [
      ...[0x10, 7], //                             0: bipush 7
      ...widened(0x36, 0x01, 0x2c), //             2: wide istore 300
      ...widened(0x84, 0x01, 0x2c, 0x00, 0x05), // 6: wide iinc 300, 5
      ...widened(0x15, 0x01, 0x2c), //            12: wide iload 300
      0xac, //                                    16: ireturn
    ];

    expect(evaluate(code, 301)).toBe(12);
  });

  it('widens the iinc constant past the signed byte the narrow form carries', () => {
    const code = [
      0x03, //                                     0: iconst_0
      ...widened(0x36, 0x01, 0x2c), //             1: wide istore 300
      ...widened(0x84, 0x01, 0x2c, 0xfe, 0xd4), // 5: wide iinc 300, -300
      ...widened(0x15, 0x01, 0x2c), //            11: wide iload 300
      0xac,
    ];

    expect(evaluate(code, 301)).toBe(-300);
  });

  it('stops on a wide form outside the executable subset, naming it as javap does', () => {
    // wide lload 300 — decoded and listed, and there are no long values to load.
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()I', code: [...widened(0x16, 0x01, 0x2c), 0xac] }],
    });

    expect(expectVmError(execute(classFile))).toMatchObject({
      kind: 'unsupported-opcode',
      mnemonic: 'lload_w',
    });
  });
});

describe('execute — the rest of the operand stack instructions', () => {
  it.each([
    // iconst_1; iconst_2; <op>; … — each program returns what the reshuffling left on top.
    { mnemonic: 'pop2', code: [0x04, 0x05, 0x06, 0x58, 0xac], answer: 1 },
    { mnemonic: 'dup_x1', code: [0x04, 0x05, 0x5a, 0x57, 0x57, 0xac], answer: 2 },
    { mnemonic: 'dup2', code: [0x04, 0x05, 0x5c, 0x57, 0xac], answer: 1 },
    { mnemonic: 'dup2_x1', code: [0x04, 0x05, 0x06, 0x5d, 0x57, 0x57, 0x57, 0xac], answer: 3 },
    { mnemonic: 'swap', code: [0x04, 0x05, 0x5f, 0xac], answer: 1 },
  ])('$mnemonic leaves $answer on top', ({ code, answer }) => {
    expect(evaluate(code)).toBe(answer);
  });

  it('reshuffles whole stacks, not just their top', () => {
    const classFile = syntheticClass({
      // iconst_1; iconst_2; iconst_3; dup2_x1; return
      methods: [{ name: 'main', descriptor: '()V', code: [0x04, 0x05, 0x06, 0x5d, 0xb1] }],
    });
    const snapshots = expectCompleted(execute(classFile)).snapshots;

    // `…, 1, 2, 3` becomes `…, 2, 3, 1, 2, 3` (JVMS §6.5 dup2_x1, form 1).
    expect(snapshots[4]?.callStack[0]?.operandStack).toEqual([2, 3, 1, 2, 3]);
  });

  it('moves references without turning them into ints', () => {
    const classFile = syntheticClass({
      // iconst_1; newarray int; iconst_7; swap; return — the array reference ends up on top
      methods: [{ name: 'main', descriptor: '()V', code: [0x04, 0xbc, 0x0a, 0x10, 7, 0x5f, 0xb1] }],
    });
    const frame = expectCompleted(execute(classFile)).snapshots.at(-2)?.callStack[0];

    expect(frame?.operandKinds).toEqual(['int', 'ref']);
    expect(frame?.operandStack).toEqual([7, 0]);
  });
});

describe('execute — shifts, bitwise logic and narrowing conversions', () => {
  it.each([
    // The int32 module is pinned by properties; these check the wiring of each opcode.
    { mnemonic: 'ishl', code: [0x04, 0x10, 33, 0x78, 0xac], answer: 2 },
    { mnemonic: 'ishr', code: [0x02, 0x04, 0x7a, 0xac], answer: -1 },
    { mnemonic: 'iushr', code: [0x02, 0x04, 0x7c, 0xac], answer: 0x7fffffff },
    { mnemonic: 'iand', code: [0x06, 0x05, 0x7e, 0xac], answer: 2 },
    { mnemonic: 'ior', code: [0x04, 0x05, 0x80, 0xac], answer: 3 },
    { mnemonic: 'ixor', code: [0x06, 0x05, 0x82, 0xac], answer: 1 },
    { mnemonic: 'i2b', code: [0x11, 0x00, 0xff, 0x91, 0xac], answer: -1 },
    { mnemonic: 'i2c', code: [0x02, 0x92, 0xac], answer: 65_535 },
    { mnemonic: 'i2s', code: [0x11, 0x80, 0x00, 0x93, 0xac], answer: -32_768 },
  ])('$mnemonic answers $answer', ({ code, answer }) => {
    expect(evaluate(code)).toBe(answer);
  });
});
