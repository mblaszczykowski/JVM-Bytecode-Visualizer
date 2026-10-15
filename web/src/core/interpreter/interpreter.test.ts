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
import {
  EXECUTABLE_OPCODES,
  execute,
  findEntryMethod,
  isEntryMethod,
  opensFrame,
} from './interpreter';
import type { Snapshot, StackFrame } from './types';

const FACTORIAL_CLASS = new URL('../classfile/__fixtures__/Factorial.class', import.meta.url);
const GCD_CLASS = new URL('../../../public/examples/Gcd.class', import.meta.url);

function parse(location: URL): ClassFile {
  return parseClassFile(new Uint8Array(readFileSync(location)).buffer);
}

function runFactorial(): readonly Snapshot[] {
  return expectCompleted(execute(parse(FACTORIAL_CLASS))).snapshots;
}

function evaluate(code: readonly number[], maxLocals = 4): number | undefined {
  const classFile = syntheticClass({
    methods: [{ name: 'main', descriptor: '()I', code, maxLocals }],
  });
  return expectCompleted(execute(classFile)).returnValue;
}

describe('execute: Factorial fixture', () => {
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

describe('execute: Gcd fixture', () => {
  it('leaves 21 in result after three backward gotos', () => {
    const snapshots = expectCompleted(execute(parse(GCD_CLASS))).snapshots;
    const backwardJumps = snapshots.filter(
      (snapshot) =>
        snapshot.currentInstruction?.mnemonic === 'goto' &&
        (snapshot.currentInstruction.branchTarget ?? 0) < snapshot.currentInstruction.offset,
    );

    expect(localValue(lastFrameOf(snapshots, 'main'), 'result')).toBe(21);
    expect(maxCallStackDepth(snapshots)).toBe(2);
    expect(backwardJumps).toHaveLength(3);
  });
});

describe('execute: entry point', () => {
  it('returns the value of an ()I entry method', () => {
    expect(evaluate([0x08, 0xac])).toBe(5);
  });

  it('runs the method named by options.entryMethod', () => {
    const classFile = syntheticClass({
      methods: [
        { name: 'main', descriptor: '()I', code: [0x03, 0xac] },
        { name: 'other', descriptor: '()I', code: [0x04, 0xac] },
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
      methods: [{ name: 'main', descriptor: '([Ljava/lang/String;)V', code: [0x1a, 0x57, 0xb1] }],
    });

    const error = expectVmError(execute(classFile));

    expect(error.kind).toBe('invalid-state');
    expect(error).toMatchObject({ offset: 0, methodName: 'main' });
    expect(error.kind === 'invalid-state' && error.message).toContain('uninitialised');
  });
});

describe('execute: instruction semantics', () => {
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
    expect(evaluate([0x10, 0xff, 0xac])).toBe(-1);
    expect(evaluate([0x10, 0x7f, 0xac])).toBe(127);
    expect(evaluate([0x11, 0x80, 0x00, 0xac])).toBe(-32_768);
    expect(evaluate([0x11, 0x7f, 0xff, 0xac])).toBe(32_767);
  });

  it('applies binary arithmetic to value1 <op> value2', () => {
    expect(evaluate([0x05, 0x06, 0x60, 0xac])).toBe(5);
    expect(evaluate([0x06, 0x05, 0x64, 0xac])).toBe(1);
    expect(evaluate([0x10, 0xf9, 0x05, 0x6c, 0xac])).toBe(-3);
    expect(evaluate([0x10, 0xf9, 0x06, 0x70, 0xac])).toBe(-1);
    expect(evaluate([0x08, 0x74, 0xac])).toBe(-5);
  });

  it('wraps imul around 32 bits', () => {
    const code = [0x11, 0x75, 0x30, 0x11, 0x75, 0x30, 0x68, 0x06, 0x68, 0xac];

    expect(evaluate(code)).toBe(-1_594_967_296);
  });

  it('duplicates and drops the top of the stack', () => {
    expect(evaluate([0x08, 0x59, 0x60, 0x04, 0x57, 0xac])).toBe(10);
  });

  it('moves values through local slots', () => {
    expect(evaluate([0x07, 0x3b, 0x08, 0x3c, 0x1a, 0x1b, 0x64, 0xac])).toBe(-1);
    expect(evaluate([0x04, 0x3d, 0x05, 0x3e, 0x1c, 0x1d, 0x60, 0xac])).toBe(3);
    expect(evaluate([0x10, 0x2a, 0x36, 0x04, 0x15, 0x04, 0xac], 6)).toBe(42);
  });

  it('does nothing for nop', () => {
    expect(evaluate([0x00, 0x04, 0xac])).toBe(1);
  });

  it('adds a negative constant with iinc', () => {
    expect(evaluate([0x10, 0x0a, 0x3b, 0x84, 0x00, 0xfd, 0x1a, 0xac])).toBe(7);
  });

  it('runs a countdown loop built from iinc, ifle and a backward goto', () => {
    const code = [
      0x10, 0x05, 0x3b, 0x03, 0x3c, 0x1a, 0x9e, 0x00, 0x0d, 0x1b, 0x1a, 0x60, 0x3c, 0x84, 0x00,
      0xff, 0xa7, 0xff, 0xf5, 0x1b, 0xac,
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
        { name: 'main', descriptor: '()I', code: [0x10, 0x0a, 0x06, 0xb8, 0x00, subtract, 0xac] },
        { name: 'subtract', descriptor: '(II)I', code: [0x1a, 0x1b, 0x64, 0xac] },
      ],
    });

    expect(expectCompleted(execute(classFile)).returnValue).toBe(7);
  });

  it('refuses a call whose arguments do not fit the max_locals the callee declares', () => {
    const pool = new ConstantPoolBuilder();
    const add3 = pool.methodref(SYNTHETIC_CLASS_NAME, 'add3', '(III)I');
    const classFile = syntheticClass({
      pool,
      methods: [
        { name: 'main', descriptor: '()I', code: [0x04, 0x05, 0x06, 0xb8, 0x00, add3, 0xac] },
        {
          name: 'add3',
          descriptor: '(III)I',
          maxLocals: 0,
          code: [0x1a, 0x1b, 0x60, 0x1c, 0x60, 0xac],
        },
      ],
    });

    expect(expectVmError(execute(classFile))).toMatchObject({
      kind: 'invalid-state',
      message: 'add3() was called with 3 argument slots, outside max_locals = 0',
      offset: 3,
      methodName: 'main',
    });
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

describe('execute: dispatch table', () => {
  it('executes exactly the opcodes the disassembler marks as supported', () => {
    const supported = [...OPCODES.values()]
      .filter((info) => info.kind === 'supported')
      .map((info) => info.opcode);

    expect([...EXECUTABLE_OPCODES].sort((a, b) => a - b)).toEqual(supported.sort((a, b) => a - b));
  });
});

describe('execute: local variable names', () => {
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

describe('execute: snapshot allocation', () => {
  function recursiveSum(n: number): ClassFile {
    const pool = new ConstantPoolBuilder();
    const sum = pool.methodref(SYNTHETIC_CLASS_NAME, 'sum', '(I)I');
    return syntheticClass({
      pool,
      methods: [
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

  it('copies a frame once per change through a thousand nested calls', () => {
    const { snapshots, returnValue } = expectCompleted(execute(recursiveSum(1000)));
    const depth = maxCallStackDepth(snapshots);

    expect(returnValue).toBe(500_500);
    expect(depth).toBe(1_002);
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

    expect(new Set(bottom).size).toBe(4);
    expect(shared.length).toBeGreaterThan(snapshots.length - 6);
  });

  it('never reuses a frame across two different calls at the same depth', () => {
    const pool = new ConstantPoolBuilder();
    const identity = pool.methodref(SYNTHETIC_CLASS_NAME, 'identity', '(I)I');
    const classFile = syntheticClass({
      pool,
      methods: [
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

function i4(value: number): readonly number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

const SWITCH_ARMS: readonly number[] = [0x04, 0xac, 0x05, 0xac, 0x02, 0xac];

function tableSwitchProgram(selector: number, defaultDelta = 26): readonly number[] {
  return [
    ...[0x10, selector],
    ...[0xaa, 0x00],
    ...i4(defaultDelta),
    ...i4(1),
    ...i4(2),
    ...i4(22),
    ...i4(24),
    ...SWITCH_ARMS,
  ];
}

function lookupSwitchProgram(selector: number): readonly number[] {
  return [
    ...[0x10, selector],
    ...[0xab, 0x00],
    ...i4(30),
    ...i4(2),
    ...i4(10),
    ...i4(26),
    ...i4(100_000),
    ...i4(28),
    ...SWITCH_ARMS,
  ];
}

describe('execute: switch dispatch', () => {
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

  it('consumes the selector and leaves the operand stack empty', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()I', code: tableSwitchProgram(1) }],
    });
    const snapshots = expectCompleted(execute(classFile)).snapshots;
    const afterDispatch = snapshots[2];

    expect(afterDispatch?.currentInstruction?.mnemonic).toBe('iconst_1');
    expect(afterDispatch?.callStack[0]?.operandStack).toEqual([]);
  });

  it('rejects a switch arm that does not point at an instruction (JVMS §4.9.1)', () => {
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

describe('execute: the wide prefix', () => {
  function widened(opcode: number, ...operands: number[]): readonly number[] {
    return [0xc4, opcode, ...operands];
  }

  it('reads and writes a local above slot 255', () => {
    const code = [
      ...[0x10, 7],
      ...widened(0x36, 0x01, 0x2c),
      ...widened(0x84, 0x01, 0x2c, 0x00, 0x05),
      ...widened(0x15, 0x01, 0x2c),
      0xac,
    ];

    expect(evaluate(code, 301)).toBe(12);
  });

  it('widens the iinc constant past the signed byte of the narrow form', () => {
    const code = [
      0x03,
      ...widened(0x36, 0x01, 0x2c),
      ...widened(0x84, 0x01, 0x2c, 0xfe, 0xd4),
      ...widened(0x15, 0x01, 0x2c),
      0xac,
    ];

    expect(evaluate(code, 301)).toBe(-300);
  });

  it('stops on an unsupported wide form and names it as javap does', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()I', code: [...widened(0x16, 0x01, 0x2c), 0xac] }],
    });

    expect(expectVmError(execute(classFile))).toMatchObject({
      kind: 'unsupported-opcode',
      mnemonic: 'lload_w',
    });
  });
});

describe('execute: remaining operand stack instructions', () => {
  it.each([
    { mnemonic: 'pop2', code: [0x04, 0x05, 0x06, 0x58, 0xac], answer: 1 },
    { mnemonic: 'dup_x1', code: [0x04, 0x05, 0x5a, 0x57, 0x57, 0xac], answer: 2 },
    { mnemonic: 'dup_x2', code: [0x04, 0x05, 0x06, 0x5b, 0x57, 0x57, 0x57, 0xac], answer: 3 },
    { mnemonic: 'dup2', code: [0x04, 0x05, 0x5c, 0x57, 0xac], answer: 1 },
    { mnemonic: 'dup2_x1', code: [0x04, 0x05, 0x06, 0x5d, 0x57, 0x57, 0x57, 0xac], answer: 3 },
    {
      mnemonic: 'dup2_x2',
      code: [0x04, 0x05, 0x06, 0x07, 0x5e, 0x57, 0x57, 0x57, 0x57, 0x57, 0xac],
      answer: 3,
    },
    { mnemonic: 'swap', code: [0x04, 0x05, 0x5f, 0xac], answer: 1 },
  ])('$mnemonic leaves $answer on top', ({ code, answer }) => {
    expect(evaluate(code)).toBe(answer);
  });

  it('rearranges the values below the top for dup2_x1', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()V', code: [0x04, 0x05, 0x06, 0x5d, 0xb1] }],
    });
    const snapshots = expectCompleted(execute(classFile)).snapshots;

    expect(snapshots[4]?.callStack[0]?.operandStack).toEqual([2, 3, 1, 2, 3]);
  });

  it('inserts the copy below both of the values under it for dup_x2 (JVMS §6.5, form 1)', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()V', code: [0x04, 0x05, 0x06, 0x5b, 0xb1] }],
    });
    const snapshots = expectCompleted(execute(classFile)).snapshots;

    expect(snapshots[4]?.callStack[0]?.operandStack).toEqual([3, 1, 2, 3]);
  });

  it('inserts both copies below both of the values under them for dup2_x2 (form 1)', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()V', code: [0x04, 0x05, 0x06, 0x07, 0x5e, 0xb1] }],
    });
    const snapshots = expectCompleted(execute(classFile)).snapshots;

    expect(snapshots[5]?.callStack[0]?.operandStack).toEqual([3, 4, 1, 2, 3, 4]);
  });

  it('moves references without turning them into ints', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()V', code: [0x04, 0xbc, 0x0a, 0x10, 7, 0x5f, 0xb1] }],
    });
    const frame = expectCompleted(execute(classFile)).snapshots.at(-2)?.callStack[0];

    expect(frame?.operandKinds).toEqual(['int', 'ref']);
    expect(frame?.operandStack).toEqual([7, 0]);
  });
});

describe('opensFrame', () => {
  const CALLABLE = syntheticClass({
    methods: [
      { name: 'main', descriptor: '()I', code: [0x03, 0xac] },
      { name: 'helper', descriptor: '(II)I', code: [0x1a, 0xac] },
      { name: 'widening', descriptor: '(J)I', code: [0x03, 0xac] },
      { name: 'declaredOnly', descriptor: '()V' },
    ],
  });

  it('answers true for a method of the loaded class the interpreter can run', () => {
    expect(opensFrame(CALLABLE, SYNTHETIC_CLASS_NAME, 'helper', '(II)I')).toBe(true);
  });

  it('answers false for a member of any class other than the one being executed', () => {
    expect(opensFrame(CALLABLE, 'java/lang/Object', '<init>', '()V')).toBe(false);
    expect(opensFrame(CALLABLE, 'java/io/PrintStream', 'println', '(I)V')).toBe(false);
  });

  it('answers false for a name or descriptor the class does not declare', () => {
    expect(opensFrame(CALLABLE, SYNTHETIC_CLASS_NAME, 'missing', '(II)I')).toBe(false);
    expect(opensFrame(CALLABLE, SYNTHETIC_CLASS_NAME, 'helper', '(I)I')).toBe(false);
  });

  it('answers false for a declared method that carries no Code attribute', () => {
    expect(opensFrame(CALLABLE, SYNTHETIC_CLASS_NAME, 'declaredOnly', '()V')).toBe(false);
  });

  it('answers false for a descriptor outside the int and reference subset', () => {
    expect(opensFrame(CALLABLE, SYNTHETIC_CLASS_NAME, 'widening', '(J)I')).toBe(false);
  });

  it('answers what the call itself does, frame for frame', () => {
    const pool = new ConstantPoolBuilder();
    const helper = pool.methodref(SYNTHETIC_CLASS_NAME, 'helper', '(II)I');
    const widening = pool.methodref(SYNTHETIC_CLASS_NAME, 'widening', '(J)I');
    const classFile = syntheticClass({
      pool,
      methods: [
        { name: 'main', descriptor: '()I', code: [0x04, 0x05, 0xb8, 0x00, helper, 0xac] },
        { name: 'callsWidening', descriptor: '()I', code: [0xb8, 0x00, widening, 0xac] },
        { name: 'helper', descriptor: '(II)I', code: [0x1a, 0xac] },
        { name: 'widening', descriptor: '(J)I', code: [0x03, 0xac] },
      ],
    });

    expect(maxCallStackDepth(expectCompleted(execute(classFile)).snapshots)).toBe(2);
    expect(expectVmError(execute(classFile, { entryMethod: 'callsWidening' })).kind).toBe(
      'unsupported-call',
    );
  });
});

describe('execute: shifts, bitwise logic and narrowing conversions', () => {
  it.each([
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

describe('execute: frame shape constraints', () => {
  it('locates an overflowing returned value at the caller invocation', () => {
    const pool = new ConstantPoolBuilder();
    const value = pool.methodref(SYNTHETIC_CLASS_NAME, 'value', '()I');
    const result = execute(
      syntheticClass({
        pool,
        methods: [
          {
            name: 'main',
            descriptor: '()V',
            maxStack: 0,
            code: [0xb8, (value >> 8) & 0xff, value & 0xff, 0x57, 0xb1],
          },
          { name: 'value', descriptor: '()I', code: [0x04, 0xac] },
        ],
      }),
    );

    expect(expectVmError(result)).toMatchObject({
      kind: 'invalid-state',
      methodName: 'main',
      offset: 0,
      message: 'operand stack exceeds max_stack = 0',
    });
    expect(result.snapshots.at(-1)?.currentInstruction?.mnemonic).toBe('ireturn');
  });

  it('refuses to push beyond max_stack', () => {
    const result = execute(
      syntheticClass({
        methods: [{ name: 'main', descriptor: '()V', maxStack: 0, code: [0x03, 0x57, 0xb1] }],
      }),
    );

    expect(expectVmError(result)).toMatchObject({
      kind: 'invalid-state',
      offset: 0,
      message: 'operand stack exceeds max_stack = 0',
    });
  });

  it.each([
    { descriptor: '()V', code: [0x03, 0xac] },
    { descriptor: '()I', code: [0xb1] },
    { descriptor: '()I', code: [0x01, 0xb0] },
  ])('refuses a mismatched return in $descriptor', ({ descriptor, code }) => {
    const result = execute(syntheticClass({ methods: [{ name: 'main', descriptor, code }] }));

    expect(expectVmError(result)).toMatchObject({
      kind: 'invalid-state',
      message: `return instruction does not match method descriptor ${descriptor}`,
    });
  });
});

describe('execute: exception dispatch shape constraints', () => {
  it('returns a typed failure when the caller cannot hold the exception reference', () => {
    const pool = new ConstantPoolBuilder();
    const boom = pool.methodref(SYNTHETIC_CLASS_NAME, 'boom', '()V');
    const result = execute(
      syntheticClass({
        pool,
        methods: [
          {
            name: 'main',
            descriptor: '()V',
            maxStack: 0,
            code: [0xb8, (boom >> 8) & 0xff, boom & 0xff, 0xb1, 0x57, 0xb1],
            exceptionTable: [{ startPc: 0, endPc: 3, handlerPc: 4 }],
          },
          { name: 'boom', descriptor: '()V', code: [0x04, 0x03, 0x6c, 0x57, 0xb1] },
        ],
      }),
    );

    expect(expectVmError(result)).toMatchObject({
      kind: 'invalid-state',
      methodName: 'main',
      offset: 0,
      message: 'operand stack exceeds max_stack = 0',
    });
    expect(result.snapshots.length).toBeGreaterThan(0);
  });
});
