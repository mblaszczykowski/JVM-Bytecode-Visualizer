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

/** Runs `code` as a static `main()V`; every program here is expected to fail somewhere. */
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

describe('execute — arithmetic faults', () => {
  it.each([
    { mnemonic: 'idiv', opcode: 0x6c },
    { mnemonic: 'irem', opcode: 0x70 },
  ])('stops on $mnemonic by zero and keeps the history', ({ opcode }) => {
    // iconst_5; iconst_0; <op>; istore_0; return
    const result = run([0x08, 0x03, opcode, 0x3b, 0xb1]);
    const error = expectVmError(result);

    expect(error).toEqual({ kind: 'division-by-zero', offset: 2, methodName: 'main' });
    expect(result.snapshots).toHaveLength(3);
    expect(result.snapshots.at(-1)?.callStack[0]?.operandStack).toEqual([5, 0]);
    expect(formatVmError(error)).toBe('ArithmeticException: / by zero — offset 2 in main().');
  });
});

describe('execute — step limit', () => {
  /** `goto` onto itself: the branch target is the offset of the instruction plus zero. */
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
    // iconst_0; pop; return — two steps, so the default limit is never reached.
    const result = expectCompleted(
      run([0x03, 0x57, 0xb1], {}, { maxSteps: Number.NaN, maxCallDepth: Number.NaN }),
    );

    expect(result.snapshots).toHaveLength(4);
  });
});

describe('execute — call depth', () => {
  /** `static void main() { main(); }` — recursion with no base case at all. */
  function selfRecursive(): ClassFile {
    const pool = new ConstantPoolBuilder();
    const self = pool.methodref(SYNTHETIC_CLASS_NAME, 'main', '()V');
    return syntheticClass({
      pool,
      // invokestatic main; return
      methods: [{ name: 'main', descriptor: '()V', code: [0xb8, 0x00, self, 0xb1] }],
    });
  }

  it('stops unbounded recursion with stack-overflow, not with the step limit', () => {
    const result = execute(selfRecursive(), { maxCallDepth: 20 });
    const error = expectVmError(result);

    expect(error).toEqual({
      kind: 'stack-overflow',
      limit: 20,
      offset: 0,
      methodName: 'main',
    });
    // One frame per step here, so the run stops as soon as the twentieth frame calls again.
    expect(result.snapshots).toHaveLength(20);
    expect(result.snapshots.at(-1)?.callStack).toHaveLength(20);
    expect(formatVmError(error)).toBe(
      'StackOverflowError: the call stack reached its limit of 20 frames — offset 0 in main().',
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
        // bipush 8; invokestatic down; ireturn
        { name: 'main', descriptor: '()I', code: [0x10, 0x08, 0xb8, 0x00, down, 0xac] },
        // iload_0; ifgt 6; iconst_0; ireturn; iload_0; iconst_1; isub; invokestatic down; ireturn
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

describe('execute — branch targets', () => {
  it.each([
    {
      case: 'past the end of the method',
      // goto +32 at offset 0; return
      code: [0xa7, 0x00, 0x20, 0xb1],
      expected: { mnemonic: 'goto', target: 32, offset: 0 },
    },
    {
      case: 'inside the operands of another instruction',
      // sipush 5; goto -2 at offset 3 — offset 1 is the first operand byte of sipush
      code: [0x11, 0x00, 0x05, 0xa7, 0xff, 0xfe, 0xb1],
      expected: { mnemonic: 'goto', target: 1, offset: 3 },
    },
    {
      case: 'before the start of the method',
      // goto -8 at offset 0; return
      code: [0xa7, 0xff, 0xf8, 0xb1],
      expected: { mnemonic: 'goto', target: -8, offset: 0 },
    },
    {
      case: 'past the end of a conditional branch',
      // iconst_0; ifeq +64 at offset 1; return
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
    // Nothing ran: the method is rejected while it is prepared, before the first fetch.
    expect(result.snapshots).toEqual([]);
  });

  it('rejects the method even when the branch is never executed', () => {
    // iconst_0; pop; return; goto +64 — the goto is dead code, and still not verifiable.
    const error = expectVmError(run([0x03, 0x57, 0xb1, 0xa7, 0x00, 0x40]));

    expect(error).toMatchObject({ kind: 'bad-branch-target', target: 67, offset: 3 });
    expect(formatVmError(error)).toBe(
      'Invalid branch target: goto jumps to offset 67, which is not the start of an instruction — offset 3 in main().',
    );
  });

  it('names the called method, not the caller, when the callee is the broken one', () => {
    const pool = new ConstantPoolBuilder();
    const broken = pool.methodref(SYNTHETIC_CLASS_NAME, 'broken', '()V');
    const result = execute(
      syntheticClass({
        pool,
        methods: [
          // nop; invokestatic broken; return
          { name: 'main', descriptor: '()V', code: [0x00, 0xb8, 0x00, broken, 0xb1] },
          // goto +9 at offset 0, which is past the end of this method
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
    // The history up to the failing call is kept, exactly as for any other fault.
    expect(result.snapshots).toHaveLength(2);
  });
});

describe('execute — unsupported instructions', () => {
  it('names the instruction that stopped the run', () => {
    // invokevirtual #1; return
    const result = run([0xb6, 0x00, 0x01, 0xb1]);

    expect(expectVmError(result)).toEqual({
      kind: 'unsupported-opcode',
      mnemonic: 'invokevirtual',
      offset: 0,
      methodName: 'main',
    });
    // The snapshot of the offending instruction stays in the history so the UI can point at it.
    expect(result.snapshots.at(-1)?.currentInstruction).toMatchObject({
      mnemonic: 'invokevirtual',
      unsupported: true,
    });
  });

  it('ignores an unsupported instruction in dead code', () => {
    const result = run([
      0x03, //             0: iconst_0
      0xa7,
      0x00,
      0x06, // 1: goto 7
      0xb6,
      0x00,
      0x01, // 4: invokevirtual #1 — never reached
      0x3b, //             7: istore_0
      0xb1, //             8: return
    ]);

    expect(expectCompleted(result).snapshots.length).toBeGreaterThan(0);
  });

  it.each([
    { case: 'a variable-length instruction', byte: 0xaa, mnemonic: 'tableswitch' },
    { case: 'a reserved opcode', byte: 0xca, mnemonic: 'breakpoint' },
    { case: 'an unassigned byte', byte: 0xcb, mnemonic: '0xcb' },
  ])('reports $case the disassembler could not decode', ({ byte, mnemonic }) => {
    // nop; <byte> — decoding stops at offset 1, so no instruction starts there.
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
    const error = expectVmError(run([0x00])); // nop, and nothing after it

    expect(error).toMatchObject({ kind: 'invalid-state', offset: 1, methodName: 'main' });
    expect(formatVmError(error)).toBe('execution ran past the end of main() — offset 1 in main().');
  });
});

describe('execute — invalid frame state', () => {
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

describe('execute — invokestatic restrictions', () => {
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
          // invokestatic #index; return
          { name: 'main', descriptor: '()V', code: [0xb8, 0x00, index, 0xb1] },
          ...extraMethods,
        ],
      }),
    );
  }

  it('refuses to call another class', () => {
    const error = expectVmError(
      callTo({ className: 'java/lang/Math', name: 'max', descriptor: '(II)I' }),
    );

    expect(error).toEqual({
      kind: 'unsupported-call',
      target: 'java/lang/Math.max(II)I',
      offset: 0,
      methodName: 'main',
    });
    expect(formatVmError(error)).toContain('java/lang/Math.max(II)I');
  });

  it.each([
    {
      case: 'a reference parameter',
      reference: { name: 'print', descriptor: '(Ljava/lang/String;)V' },
      extras: [{ name: 'print', descriptor: '(Ljava/lang/String;)V', code: [0xb1] }],
    },
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

describe('execute — malformed constant pool', () => {
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
