import { describe, expect, it } from 'vitest';

import { ConstantTag, type ClassFile } from '../classfile';
import { expectCompleted, expectStepLimit, expectVmError } from './__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
  type SyntheticMethod,
} from './__fixtures__/synthetic-class';
import { formatVmError } from './errors';
import { execute } from './interpreter';
import {
  DEFAULT_MAX_CALL_DEPTH,
  DEFAULT_MAX_STEPS,
  type ExecuteOptions,
  type ExecutionResult,
} from './types';

function run(
  code: readonly number[],
  overrides: Partial<SyntheticMethod> = {},
  options: ExecuteOptions = {},
): ExecutionResult {
  return execute(
    syntheticClass({ methods: [{ name: 'main', descriptor: '()V', code, ...overrides }] }),
    options,
  );
}

describe('execute: arithmetic faults', () => {
  it.each([
    { mnemonic: 'idiv', opcode: 0x6c },
    { mnemonic: 'irem', opcode: 0x70 },
  ])('stops on $mnemonic by zero and keeps the history', ({ opcode }) => {
    const result = run([0x08, 0x03, opcode, 0x3b, 0xb1]);
    const error = expectVmError(result);

    expect(error).toEqual({ kind: 'division-by-zero', offset: 2, methodName: 'main' });
    expect(result.snapshots).toHaveLength(3);
    expect(result.snapshots.at(-1)?.callStack[0]?.operandStack).toEqual([5, 0]);
    expect(formatVmError(error)).toBe('ArithmeticException: / by zero (offset 2 in main()).');
  });
});

describe('execute: step limit', () => {
  const INFINITE_LOOP = [0xa7, 0x00, 0x00];

  it('stops an infinite loop at the default limit', () => {
    const result = expectStepLimit(run(INFINITE_LOOP));

    expect(result.limit).toBe(DEFAULT_MAX_STEPS);
    expect(result.snapshots).toHaveLength(DEFAULT_MAX_STEPS);
  });

  it('counts executed instructions against the limit from the options', () => {
    const classFile = syntheticClass({
      methods: [{ name: 'main', descriptor: '()V', code: INFINITE_LOOP }],
    });

    const result = expectStepLimit(execute(classFile, { maxSteps: 50 }));

    expect(result.limit).toBe(50);
    expect(result.snapshots).toHaveLength(50);
    expect(result.snapshots.at(-1)?.step).toBe(49);
    expect(
      result.snapshots.every((snapshot) => snapshot.currentInstruction?.mnemonic === 'goto'),
    ).toBe(true);
  });

  it.each([{ maxSteps: 0 }, { maxSteps: -1 }, { maxSteps: 0.4 }])(
    'runs one instruction rather than none for maxSteps $maxSteps',
    ({ maxSteps }) => {
      const classFile = syntheticClass({
        methods: [{ name: 'main', descriptor: '()V', code: INFINITE_LOOP }],
      });

      const result = expectStepLimit(execute(classFile, { maxSteps }));

      expect(result.limit).toBe(1);
      expect(result.snapshots).toHaveLength(1);
    },
  );

  it('falls back to the default for a limit that is not a number', () => {
    const result = expectCompleted(
      run([0x03, 0x57, 0xb1], {}, { maxSteps: Number.NaN, maxCallDepth: Number.NaN }),
    );

    expect(result.snapshots).toHaveLength(4);
  });
});

describe('execute: call depth', () => {
  function selfRecursive(): ClassFile {
    const pool = new ConstantPoolBuilder();
    const self = pool.methodref(SYNTHETIC_CLASS_NAME, 'main', '()V');
    return syntheticClass({
      pool,
      methods: [{ name: 'main', descriptor: '()V', code: [0xb8, 0x00, self, 0xb1] }],
    });
  }

  it('stops unbounded recursion with stack-overflow before the step limit', () => {
    const result = execute(selfRecursive(), { maxCallDepth: 20 });
    const error = expectVmError(result);

    expect(error).toEqual({
      kind: 'stack-overflow',
      limit: 20,
      offset: 0,
      methodName: 'main',
    });
    expect(result.snapshots).toHaveLength(20);
    expect(result.snapshots.at(-1)?.callStack).toHaveLength(20);
    expect(formatVmError(error)).toBe(
      'StackOverflowError: the call stack reached its limit of 20 frames (offset 0 in main()).',
    );
  });

  it('applies DEFAULT_MAX_CALL_DEPTH long before the step limit', () => {
    const result = execute(selfRecursive());

    expect(expectVmError(result).kind).toBe('stack-overflow');
    expect(result.snapshots).toHaveLength(DEFAULT_MAX_CALL_DEPTH);
    expect(DEFAULT_MAX_CALL_DEPTH).toBeLessThan(DEFAULT_MAX_STEPS);
  });

  it('lets a recursion that stays below the limit finish', () => {
    const pool = new ConstantPoolBuilder();
    const down = pool.methodref(SYNTHETIC_CLASS_NAME, 'down', '(I)I');
    const classFile = syntheticClass({
      pool,
      methods: [
        { name: 'main', descriptor: '()I', code: [0x10, 0x08, 0xb8, 0x00, down, 0xac] },
        {
          name: 'down',
          descriptor: '(I)I',
          code: [0x1a, 0x9d, 0x00, 0x05, 0x03, 0xac, 0x1a, 0x04, 0x64, 0xb8, 0x00, down, 0xac],
          maxLocals: 1,
        },
      ],
    });

    expect(expectCompleted(execute(classFile, { maxCallDepth: 10 })).returnValue).toBe(0);
  });
});

describe('execute: branch targets', () => {
  it.each([
    {
      case: 'past the end of the method',
      code: [0xa7, 0x00, 0x20, 0xb1],
      expected: { mnemonic: 'goto', target: 32, offset: 0 },
    },
    {
      case: 'inside the operands of another instruction',
      code: [0x11, 0x00, 0x05, 0xa7, 0xff, 0xfe, 0xb1],
      expected: { mnemonic: 'goto', target: 1, offset: 3 },
    },
    {
      case: 'before the start of the method',
      code: [0xa7, 0xff, 0xf8, 0xb1],
      expected: { mnemonic: 'goto', target: -8, offset: 0 },
    },
    {
      case: 'past the end of a conditional branch',
      code: [0x03, 0x99, 0x00, 0x40, 0xb1],
      expected: { mnemonic: 'ifeq', target: 65, offset: 1 },
    },
  ])('reports a branch target $case', ({ code, expected }) => {
    const result = run(code);

    expect(expectVmError(result)).toEqual({
      kind: 'bad-branch-target',
      ...expected,
      methodName: 'main',
    });
    expect(result.snapshots).toEqual([]);
  });

  it('rejects the method even when the branch is never executed', () => {
    const error = expectVmError(run([0x03, 0x57, 0xb1, 0xa7, 0x00, 0x40]));

    expect(error).toMatchObject({ kind: 'bad-branch-target', target: 67, offset: 3 });
    expect(formatVmError(error)).toBe(
      'Invalid branch target: goto jumps to offset 67, which is not the start of an instruction (offset 3 in main()).',
    );
  });

  it('names the callee as the method holding the bad branch target', () => {
    const pool = new ConstantPoolBuilder();
    const broken = pool.methodref(SYNTHETIC_CLASS_NAME, 'broken', '()V');
    const result = execute(
      syntheticClass({
        pool,
        methods: [
          { name: 'main', descriptor: '()V', code: [0x00, 0xb8, 0x00, broken, 0xb1] },
          { name: 'broken', descriptor: '()V', code: [0xa7, 0x00, 0x09, 0xb1] },
        ],
      }),
    );

    expect(expectVmError(result)).toEqual({
      kind: 'bad-branch-target',
      mnemonic: 'goto',
      target: 9,
      offset: 0,
      methodName: 'broken',
    });
    expect(result.snapshots).toHaveLength(2);
  });
});

describe('execute: unsupported instructions', () => {
  it('names the instruction that stopped the run', () => {
    const result = run([0xc2, 0xb1]);

    expect(expectVmError(result)).toEqual({
      kind: 'unsupported-opcode',
      mnemonic: 'monitorenter',
      offset: 0,
      methodName: 'main',
    });
    expect(result.snapshots.at(-1)?.currentInstruction).toMatchObject({
      mnemonic: 'monitorenter',
      unsupported: true,
    });
  });

  it('ignores an unsupported instruction in dead code', () => {
    const result = run([0x03, 0xa7, 0x00, 0x06, 0xbb, 0x00, 0x01, 0x3b, 0xb1]);

    expect(expectCompleted(result).snapshots.length).toBeGreaterThan(0);
  });

  it.each([
    { case: 'a variable-length instruction', byte: 0xaa, mnemonic: 'tableswitch' },
    { case: 'a reserved opcode', byte: 0xca, mnemonic: 'breakpoint' },
    { case: 'an unassigned byte', byte: 0xcb, mnemonic: '0xcb' },
  ])('reports $case the disassembler could not decode', ({ byte, mnemonic }) => {
    const result = run([0x00, byte, 0x00, 0x00, 0x00]);

    expect(expectVmError(result)).toEqual({
      kind: 'unsupported-opcode',
      mnemonic,
      offset: 1,
      methodName: 'main',
    });
    expect(result.snapshots).toHaveLength(1);
  });

  it('reports execution running off the end of a method', () => {
    const error = expectVmError(run([0x00]));

    expect(error).toMatchObject({ kind: 'invalid-state', offset: 1, methodName: 'main' });
    expect(formatVmError(error)).toBe('execution ran past the end of main() (offset 1 in main()).');
  });
});

describe('execute: invalid frame state', () => {
  it.each([
    { mnemonic: 'iadd', code: [0x60] },
    { mnemonic: 'pop', code: [0x57] },
    { mnemonic: 'dup', code: [0x59] },
  ])('reports an operand stack underflow at $mnemonic', ({ code }) => {
    const error = expectVmError(run(code));

    expect(error).toEqual({
      kind: 'invalid-state',
      message: 'operand stack underflow',
      offset: 0,
      methodName: 'main',
    });
  });

  it.each([
    { mnemonic: 'iload', code: [0x15, 0x09, 0x57, 0xb1], offset: 0 },
    { mnemonic: 'istore', code: [0x04, 0x36, 0x09, 0xb1], offset: 1 },
    { mnemonic: 'iinc', code: [0x84, 0x09, 0x01, 0xb1], offset: 0 },
  ])('rejects the out-of-range local slot of $mnemonic', ({ code, offset }) => {
    const error = expectVmError(run(code, { maxLocals: 2 }));

    expect(error).toEqual({
      kind: 'invalid-state',
      message: 'local slot 9 outside max_locals = 2',
      offset,
      methodName: 'main',
    });
  });
});

describe('execute: array faults', () => {
  const T_INT = 0x0a;

  it.each([
    {
      case: 'reading past the end',
      code: [0x06, 0xbc, T_INT, 0x08, 0x2e, 0xb1],
      expected: { index: 5, length: 3, offset: 4 },
    },
    {
      case: 'reading before the start',
      code: [0x06, 0xbc, T_INT, 0x02, 0x2e, 0xb1],
      expected: { index: -1, length: 3, offset: 4 },
    },
    {
      case: 'writing past the end',
      code: [0x06, 0xbc, T_INT, 0x10, 0x07, 0x03, 0x4f, 0xb1],
      expected: { index: 7, length: 3, offset: 6 },
    },
    {
      case: 'writing before the start',
      code: [0x06, 0xbc, T_INT, 0x02, 0x03, 0x4f, 0xb1],
      expected: { index: -1, length: 3, offset: 5 },
    },
    {
      case: 'touching an empty array at all',
      code: [0x03, 0xbc, T_INT, 0x03, 0x2e, 0xb1],
      expected: { index: 0, length: 0, offset: 4 },
    },
  ])('reports an index out of bounds when $case', ({ code, expected }) => {
    expect(expectVmError(run(code))).toEqual({
      kind: 'array-index-out-of-bounds',
      ...expected,
      methodName: 'main',
    });
  });

  it('names the index and the length the way the JVM exception does', () => {
    const error = expectVmError(run([0x06, 0xbc, T_INT, 0x08, 0x2e, 0xb1]));

    expect(formatVmError(error)).toBe(
      'ArrayIndexOutOfBoundsException: index 5 out of bounds for length 3 (offset 4 in main()).',
    );
  });

  it.each([
    { case: 'iconst_m1', code: [0x02, 0xbc, T_INT, 0x4b, 0xb1], size: -1 },
    { case: 'bipush', code: [0x10, 0xfb, 0xbc, T_INT, 0x4b, 0xb1], size: -5 },
  ])('refuses to allocate a negative length from $case', ({ code, size }) => {
    const error = expectVmError(run(code));

    expect(error).toMatchObject({ kind: 'negative-array-size', size, methodName: 'main' });
    expect(formatVmError(error)).toContain(`NegativeArraySizeException: ${String(size)}`);
  });

  it.each([
    { mnemonic: 'arraylength', code: [0x01, 0xbe, 0x57, 0xb1], offset: 1 },
    { mnemonic: 'iaload', code: [0x01, 0x03, 0x2e, 0x57, 0xb1], offset: 2 },
    { mnemonic: 'iastore', code: [0x01, 0x03, 0x03, 0x4f, 0xb1], offset: 3 },
  ])('stops $mnemonic on a null reference', ({ code, offset }) => {
    const error = expectVmError(run(code));

    expect(error).toEqual({ kind: 'null-reference', offset, methodName: 'main' });
    expect(formatVmError(error)).toBe(
      `NullPointerException: the reference is null (offset ${String(offset)} in main()).`,
    );
  });

  it.each([
    { case: 'long', atype: 0x0b, typeName: 'long[]' },
    { case: 'double', atype: 0x07, typeName: 'double[]' },
    { case: 'boolean', atype: 0x04, typeName: 'boolean[]' },
    { case: 'an unassigned atype', atype: 0x03, typeName: 'atype 3' },
  ])('refuses to allocate an array of $case', ({ atype, typeName }) => {
    const error = expectVmError(run([0x04, 0xbc, atype, 0x4b, 0xb1]));

    expect(error).toEqual({
      kind: 'unsupported-array-type',
      typeName,
      offset: 1,
      methodName: 'main',
    });
    expect(formatVmError(error)).toBe(
      `Unsupported array type: ${typeName}; only int arrays can be allocated (offset 1 in main()).`,
    );
  });

  it('leaves the count on the stack when the element type is the problem', () => {
    const result = run([0x04, 0xbc, 0x0b, 0x4b, 0xb1]);

    expect(expectVmError(result).kind).toBe('unsupported-array-type');
    expect(result.snapshots.at(-1)?.callStack[0]?.operandStack).toEqual([1]);
  });
});

describe('execute: reading a value as the wrong kind', () => {
  const T_INT = 0x0a;

  it.each([
    {
      case: 'aload on a slot holding an int',
      code: [0x04, 0x3b, 0x2a, 0x57, 0xb1],
      message: 'local slot 0 holds an int, not a reference',
      offset: 2,
    },
    {
      case: 'iload on a slot holding a reference',
      code: [0x04, 0xbc, T_INT, 0x4b, 0x1a, 0x57, 0xb1],
      message: 'local slot 0 holds a reference, not an int',
      offset: 4,
    },
    {
      case: 'aload on a slot that was never written',
      code: [0x2b, 0x57, 0xb1],
      message: 'read from uninitialised local slot 1',
      offset: 0,
    },
    {
      case: 'arithmetic on a reference',
      code: [0x04, 0xbc, T_INT, 0x04, 0x60, 0xb1],
      message: 'expected an int on the operand stack, found a reference',
      offset: 4,
    },
    {
      case: 'astore of an int',
      code: [0x04, 0x4b, 0xb1],
      message: 'expected a reference on the operand stack, found an int',
      offset: 1,
    },
    {
      case: 'arraylength of an int',
      code: [0x04, 0xbe, 0x57, 0xb1],
      message: 'expected a reference on the operand stack, found an int',
      offset: 1,
    },
  ])('rejects $case', ({ code, message, offset }) => {
    expect(expectVmError(run(code))).toEqual({
      kind: 'invalid-state',
      message,
      offset,
      methodName: 'main',
    });
  });
});

describe('execute: invokestatic restrictions', () => {
  function callTo(
    reference: { className?: string; name: string; descriptor: string },
    extraMethods: readonly SyntheticMethod[] = [],
  ): ExecutionResult {
    const pool = new ConstantPoolBuilder();
    const index = pool.methodref(
      reference.className ?? SYNTHETIC_CLASS_NAME,
      reference.name,
      reference.descriptor,
    );
    return execute(
      syntheticClass({
        pool,
        methods: [
          { name: 'main', descriptor: '()V', code: [0xb8, 0x00, index, 0xb1] },
          ...extraMethods,
        ],
      }),
    );
  }

  it('refuses to call a class it has no implementation for', () => {
    const error = expectVmError(
      callTo({ className: 'java/lang/Math', name: 'sqrt', descriptor: '(D)D' }),
    );

    expect(error).toEqual({
      kind: 'unsupported-call',
      target: 'java/lang/Math.sqrt(D)D',
      offset: 0,
      methodName: 'main',
    });
    expect(formatVmError(error)).toContain('java/lang/Math.sqrt(D)D');
  });

  it.each([
    {
      case: 'a long parameter',
      reference: { name: 'wide', descriptor: '(J)V' },
      extras: [{ name: 'wide', descriptor: '(J)V', code: [0xb1] }],
    },
    {
      case: 'a malformed descriptor',
      reference: { name: 'weird', descriptor: '(Q)V' },
      extras: [{ name: 'weird', descriptor: '(Q)V', code: [0xb1] }],
    },
    { case: 'no such method', reference: { name: 'absent', descriptor: '()V' }, extras: [] },
    {
      case: 'no Code attribute',
      reference: { name: 'native0', descriptor: '()V' },
      extras: [{ name: 'native0', descriptor: '()V' }],
    },
    {
      case: 'a non-static target',
      reference: { name: 'instance', descriptor: '()V' },
      extras: [{ name: 'instance', descriptor: '()V', code: [0xb1], accessFlags: 0 }],
    },
  ])('refuses a call with $case', ({ reference, extras }) => {
    const error = expectVmError(callTo(reference, extras));

    expect(error).toEqual({
      kind: 'unsupported-call',
      target: `${SYNTHETIC_CLASS_NAME}.${reference.name}${reference.descriptor}`,
      offset: 0,
      methodName: 'main',
    });
  });
});

describe('execute: malformed constant pool', () => {
  function callIndex(index: number, pool: ConstantPoolBuilder): ExecutionResult {
    return execute(
      syntheticClass({
        pool,
        methods: [{ name: 'main', descriptor: '()V', code: [0xb8, 0x00, index, 0xb1] }],
      }),
    );
  }

  it('rejects an index that is not a Methodref', () => {
    const pool = new ConstantPoolBuilder();
    const utf8 = pool.utf8('not a method');

    expect(expectVmError(callIndex(utf8, pool))).toMatchObject({
      kind: 'invalid-state',
      message: `constant pool entry #${String(utf8)} is not a Methodref`,
    });
  });

  it('rejects an empty pool slot', () => {
    expect(expectVmError(callIndex(0, new ConstantPoolBuilder()))).toMatchObject({
      kind: 'invalid-state',
      message: 'constant pool entry #0 is not a Methodref',
    });
  });

  it('rejects a Methodref whose class_index is not a Class', () => {
    const pool = new ConstantPoolBuilder();
    const utf8 = pool.utf8('bogus');
    const reference = pool.raw({
      tag: ConstantTag.Methodref,
      classIndex: utf8,
      nameAndTypeIndex: utf8,
    });

    expect(expectVmError(callIndex(reference, pool))).toMatchObject({
      message: `constant pool entry #${String(utf8)} is not a Class`,
    });
  });

  it('rejects a Methodref whose name_and_type_index is not a NameAndType', () => {
    const pool = new ConstantPoolBuilder();
    const owner = pool.classEntry(SYNTHETIC_CLASS_NAME);
    const utf8 = pool.utf8('bogus');
    const reference = pool.raw({
      tag: ConstantTag.Methodref,
      classIndex: owner,
      nameAndTypeIndex: utf8,
    });

    expect(expectVmError(callIndex(reference, pool))).toMatchObject({
      message: `constant pool entry #${String(utf8)} is not a NameAndType`,
    });
  });

  it('rejects a NameAndType that does not point at Utf8 entries', () => {
    const pool = new ConstantPoolBuilder();
    const owner = pool.classEntry(SYNTHETIC_CLASS_NAME);
    const nameAndType = pool.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: owner,
      descriptorIndex: owner,
    });
    const reference = pool.raw({
      tag: ConstantTag.Methodref,
      classIndex: owner,
      nameAndTypeIndex: nameAndType,
    });

    expect(expectVmError(callIndex(reference, pool))).toMatchObject({
      message: `constant pool entry #${String(owner)} is not a Utf8`,
    });
  });
});
