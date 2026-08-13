import { describe, expect, it } from 'vitest';

import { ConstantTag } from '../classfile';
import { debugVmError, expectCompleted, expectVmError } from './__fixtures__/expect-execution';
import { ConstantPoolBuilder, syntheticClass } from './__fixtures__/synthetic-class';
import { execute } from './interpreter';
import type { ExecutionResult, Snapshot } from './types';

const PRINT_STREAM = 'java/io/PrintStream';

function u2(index: number): readonly number[] {
  return [(index >> 8) & 0xff, index & 0xff];
}

interface Program {
  readonly pool: ConstantPoolBuilder;
  readonly code: readonly number[];
  readonly maxLocals?: number;
}

function run({ pool, code, maxLocals = 4 }: Program): ExecutionResult {
  return execute(
    syntheticClass({ pool, methods: [{ name: 'main', descriptor: '()V', code, maxLocals }] }),
  );
}

function consoleOf(program: Program): readonly string[] {
  return expectCompleted(run(program)).snapshots.at(-1)?.consoleOutput ?? [];
}

function systemOut(pool: ConstantPoolBuilder): readonly number[] {
  return [0xb2, ...u2(pool.fieldref('java/lang/System', 'out', 'Ljava/io/PrintStream;'))];
}

function printStream(pool: ConstantPoolBuilder, name: string, descriptor: string): number {
  return pool.methodref(PRINT_STREAM, name, descriptor);
}

function printCall(
  pool: ConstantPoolBuilder,
  member: number,
  argument: readonly number[] = [],
): readonly number[] {
  return [...systemOut(pool), ...argument, 0xb6, ...u2(member)];
}

describe('execute: printing through System.out', () => {
  it('prints an int the way Java renders it', () => {
    const pool = new ConstantPoolBuilder();
    const println = printStream(pool, 'println', '(I)V');

    expect(
      consoleOf({
        pool,
        code: [...systemOut(pool), 0x10, 42, 0xb6, ...u2(println), 0xb1],
      }),
    ).toEqual(['42']);
  });

  it('renders the same int differently for the boolean and char overloads', () => {
    const pool = new ConstantPoolBuilder();
    const asBoolean = printStream(pool, 'println', '(Z)V');
    const asChar = printStream(pool, 'println', '(C)V');

    expect(
      consoleOf({
        pool,
        code: [
          ...printCall(pool, asBoolean, [0x03]),
          ...printCall(pool, asBoolean, [0x04]),
          ...printCall(pool, asChar, [0x10, 65]),
          0xb1,
        ],
      }),
    ).toEqual(['false', 'true', 'A']);
  });

  it('keeps a line open until a println closes it', () => {
    const pool = new ConstantPoolBuilder();
    const print = printStream(pool, 'print', '(I)V');
    const println = printStream(pool, 'println', '()V');

    expect(
      consoleOf({
        pool,
        code: [
          ...printCall(pool, print, [0x04]),
          ...printCall(pool, print, [0x05]),
          ...printCall(pool, println),
          ...printCall(pool, print, [0x06]),
          0xb1,
        ],
      }),
    ).toEqual(['12', '3']);
  });

  it('splits a printed string on the line terminators inside it', () => {
    const pool = new ConstantPoolBuilder();
    const text = pool.stringEntry('one\ntwo\n');
    const print = printStream(pool, 'print', '(Ljava/lang/String;)V');

    expect(
      consoleOf({
        pool,
        code: [...systemOut(pool), 0x12, text, 0xb6, ...u2(print), 0xb1],
      }),
    ).toEqual(['one', 'two']);
  });

  it('prints a null String as the four characters PrintStream writes for it', () => {
    const pool = new ConstantPoolBuilder();
    const println = printStream(pool, 'println', '(Ljava/lang/String;)V');
    const print = printStream(pool, 'print', '(Ljava/lang/String;)V');

    expect(
      consoleOf({
        pool,
        code: [
          ...printCall(pool, println, [0x01]),
          ...[0x01, 0x4c],
          ...printCall(pool, print, [0x2b]),
          ...printCall(pool, printStream(pool, 'println', '()V')),
          0xb1,
        ],
      }),
    ).toEqual(['null', 'null']);
  });

  it('refuses a reference to the heap where a String is expected', () => {
    const pool = new ConstantPoolBuilder();
    const println = printStream(pool, 'println', '(Ljava/lang/String;)V');
    const error = expectVmError(
      run({ pool, code: [...printCall(pool, println, [0x04, 0xbc, 0x0a]), 0xb1] }),
    );

    expect(error).toMatchObject({
      kind: 'invalid-state',
      message: 'argument names no known object',
    });
  });

  it('names System.out on the operand stack instead of leaving a bare number', () => {
    const pool = new ConstantPoolBuilder();
    const snapshots = expectCompleted(
      run({ pool, code: [...systemOut(pool), 0x57, 0xb1] }),
    ).snapshots;
    const afterGetstatic = snapshots[1];

    expect(afterGetstatic?.callStack[0]?.operandKinds).toEqual(['external']);
    expect(afterGetstatic?.externals).toEqual([{ className: PRINT_STREAM, label: 'System.out' }]);
  });
});

describe('execute: ldc', () => {
  it('pushes an int constant from the pool', () => {
    const pool = new ConstantPoolBuilder();
    const constant = pool.integer(123_456_789);
    const classFile = syntheticClass({
      pool,
      methods: [{ name: 'main', descriptor: '()I', code: [0x12, constant, 0xac] }],
    });

    expect(expectCompleted(execute(classFile)).returnValue).toBe(123_456_789);
  });

  it('reads a two-byte pool index for ldc_w', () => {
    const pool = new ConstantPoolBuilder();
    const constant = pool.integer(-7);
    const classFile = syntheticClass({
      pool,
      methods: [{ name: 'main', descriptor: '()I', code: [0x13, ...u2(constant), 0xac] }],
    });

    expect(expectCompleted(execute(classFile)).returnValue).toBe(-7);
  });

  it('gives one object to every ldc of the same String constant (JVMS §5.1)', () => {
    const pool = new ConstantPoolBuilder();
    const text = pool.stringEntry('shared');
    const snapshots: readonly Snapshot[] = expectCompleted(
      run({ pool, code: [0x12, text, 0x12, text, 0x4c, 0x4d, 0xb1] }),
    ).snapshots;
    const beforeStore = snapshots[2];

    expect(beforeStore?.callStack[0]?.operandStack).toEqual([0, 0]);
    expect(snapshots.at(-1)?.externals).toEqual([
      { className: 'java/lang/String', label: '"shared"', text: 'shared' },
    ]);
  });

  it.each([
    { tagName: 'Float', entry: { tag: ConstantTag.Float, value: 1.5 } as const },
    { tagName: 'Long', entry: { tag: ConstantTag.Long, value: 4_294_967_296n } as const },
    { tagName: 'Double', entry: { tag: ConstantTag.Double, value: 0.5 } as const },
  ])('refuses the $tagName the parser now reads, naming the entry', ({ tagName, entry }) => {
    const pool = new ConstantPoolBuilder();
    const constant = pool.raw(entry);
    const error = expectVmError(run({ pool, code: [0x12, constant, 0xb1] }));

    expect(error).toEqual({
      kind: 'unsupported-constant',
      target: `the ${tagName} constant at #${String(constant)}`,
      offset: 0,
      methodName: 'main',
    });
    expect(debugVmError(error)).toContain(`Unsupported constant: the ${tagName} constant at #`);
  });

  it('names an index that resolves to nothing', () => {
    const pool = new ConstantPoolBuilder();
    const error = expectVmError(run({ pool, code: [0x12, 200, 0xb1] }));

    expect(error).toMatchObject({
      kind: 'unsupported-constant',
      target: 'constant pool entry #200',
    });
  });
});

describe('execute: unrecognised members', () => {
  it('refuses a static field outside the table', () => {
    const pool = new ConstantPoolBuilder();
    const field = pool.fieldref('java/lang/System', 'in', 'Ljava/io/InputStream;');
    const error = expectVmError(run({ pool, code: [0xb2, ...u2(field), 0xb1] }));

    expect(error).toEqual({
      kind: 'unsupported-field',
      target: 'java/lang/System.in:Ljava/io/InputStream;',
      offset: 0,
      methodName: 'main',
    });
    expect(debugVmError(error)).toContain('java/lang/System.in:Ljava/io/InputStream;');
  });

  it('refuses a virtual call outside the table', () => {
    const pool = new ConstantPoolBuilder();
    const flush = printStream(pool, 'flush', '()V');
    const error = expectVmError(
      run({ pool, code: [...systemOut(pool), 0xb6, ...u2(flush), 0xb1] }),
    );

    expect(error).toEqual({
      kind: 'unsupported-call',
      target: 'java/io/PrintStream.flush()V',
      offset: 3,
      methodName: 'main',
    });
  });

  it('refuses a recognised method invoked on the wrong object', () => {
    const pool = new ConstantPoolBuilder();
    const text = pool.stringEntry('not a stream');
    const println = printStream(pool, 'println', '()V');
    const error = expectVmError(run({ pool, code: [0x12, text, 0xb6, ...u2(println), 0xb1] }));

    expect(error).toEqual({
      kind: 'unsupported-call',
      target: 'java/io/PrintStream.println()V on "not a stream"',
      offset: 2,
      methodName: 'main',
    });
  });

  it('refuses a virtual call on something that is not an object at all', () => {
    const pool = new ConstantPoolBuilder();
    const println = printStream(pool, 'println', '()V');
    const error = expectVmError(run({ pool, code: [0x04, 0xb6, ...u2(println), 0xb1] }));

    expect(error).toMatchObject({
      kind: 'invalid-state',
      message: 'expected a standard library object on the operand stack, found an int',
    });
  });

  it('refuses a Fieldref index that does not point at a field', () => {
    const pool = new ConstantPoolBuilder();
    const method = printStream(pool, 'println', '()V');
    const error = expectVmError(run({ pool, code: [0xb2, ...u2(method), 0xb1] }));

    expect(error).toMatchObject({ kind: 'invalid-state' });
    expect(debugVmError(error)).toContain('is not a Fieldref');
  });
});

describe('execute: java.lang.Math intrinsics', () => {
  function callMath(name: string, descriptor: string, args: readonly number[]): ExecutionResult {
    const pool = new ConstantPoolBuilder();
    const method = pool.methodref('java/lang/Math', name, descriptor);
    return execute(
      syntheticClass({
        pool,
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [
              ...args.flatMap((value) => [0x12, pool.integer(value)]),
              0xb8,
              ...u2(method),
              0xac,
            ],
          },
        ],
      }),
    );
  }

  it.each([
    { call: 'max(3, 9)', name: 'max', descriptor: '(II)I', args: [3, 9], result: 9 },
    { call: 'max(-3, -9)', name: 'max', descriptor: '(II)I', args: [-3, -9], result: -3 },
    { call: 'min(3, 9)', name: 'min', descriptor: '(II)I', args: [3, 9], result: 3 },
    { call: 'abs(-5)', name: 'abs', descriptor: '(I)I', args: [-5], result: 5 },
    {
      call: 'abs(Integer.MIN_VALUE)',
      name: 'abs',
      descriptor: '(I)I',
      args: [-2_147_483_648],
      result: -2_147_483_648,
    },
    { call: 'floorDiv(-7, 2)', name: 'floorDiv', descriptor: '(II)I', args: [-7, 2], result: -4 },
    { call: 'floorMod(-7, 2)', name: 'floorMod', descriptor: '(II)I', args: [-7, 2], result: 1 },
  ])('answers $call with $result', ({ name, descriptor, args, result }) => {
    expect(expectCompleted(callMath(name, descriptor, args)).returnValue).toBe(result);
  });

  it('throws the arithmetic exception a real JVM throws for floorDiv by zero', () => {
    for (const name of ['floorDiv', 'floorMod']) {
      expect(expectVmError(callMath(name, '(II)I', [1, 0]))).toMatchObject({
        kind: 'division-by-zero',
      });
    }
  });

  it('passes arguments in declaration order', () => {
    expect(expectCompleted(callMath('floorDiv', '(II)I', [9, 4])).returnValue).toBe(2);
    expect(expectCompleted(callMath('floorDiv', '(II)I', [4, 9])).returnValue).toBe(0);
  });
});

describe('execute: external object references in local slots', () => {
  it('stores and loads a String constant like any other reference', () => {
    const pool = new ConstantPoolBuilder();
    const text = pool.stringEntry('via a local');
    const println = printStream(pool, 'println', '(Ljava/lang/String;)V');

    expect(
      consoleOf({
        pool,
        code: [0x12, text, 0x4c, ...systemOut(pool), 0x2b, 0xb6, ...u2(println), 0xb1],
      }),
    ).toEqual(['via a local']);
  });

  it('refuses to read an int slot as a reference', () => {
    const pool = new ConstantPoolBuilder();
    const error = expectVmError(run({ pool, code: [0x04, 0x3c, 0x2b, 0xb1] }));

    expect(error).toMatchObject({
      kind: 'invalid-state',
      message: 'local slot 1 holds an int, not a reference',
    });
  });

  it('refuses to store an int through astore', () => {
    const pool = new ConstantPoolBuilder();
    const error = expectVmError(run({ pool, code: [0x04, 0x4c, 0xb1] }));

    expect(error).toMatchObject({
      kind: 'invalid-state',
      message: 'expected a reference on the operand stack, found an int',
    });
  });
});
