import { describe, expect, it } from 'vitest';

import type { ExceptionTableEntry } from '../classfile';

import { expectCompleted, expectVmError } from './__fixtures__/expect-execution';
import { ConstantPoolBuilder, syntheticClass } from './__fixtures__/synthetic-class';
import { execute } from './interpreter';
import { catches } from './throwable';
import { DEFAULT_MAX_CALL_DEPTH, type Snapshot } from './types';

const T_INT = 0x0a;

function handler(
  startPc: number,
  endPc: number,
  handlerPc: number,
  catchType?: string,
): ExceptionTableEntry {
  return {
    startPc,
    endPc,
    handlerPc,
    ...(catchType === undefined ? {} : { catchType }),
  };
}

const DIVIDE_BY_ZERO: readonly number[] = [0x04, 0x03, 0x6c, 0xac];

function divideWithHandler(
  entries: readonly ExceptionTableEntry[],
  maxLocals = 2,
): ReturnType<typeof execute> {
  return execute(
    syntheticClass({
      methods: [
        {
          name: 'main',
          descriptor: '()I',
          code: [...DIVIDE_BY_ZERO, 0x4c, 0x02, 0xac],
          maxLocals,
          exceptionTable: entries,
        },
      ],
    }),
  );
}

describe('the exception table', () => {
  it('catches the exception and carries on from the handler', () => {
    const result = divideWithHandler([handler(0, 4, 4, 'java/lang/ArithmeticException')]);

    expect(expectCompleted(result).returnValue).toBe(-1);
  });

  it('catches nothing when the handler names a class that is not a supertype', () => {
    const error = expectVmError(
      divideWithHandler([handler(0, 4, 4, 'java/lang/NullPointerException')]),
    );

    expect(error.kind).toBe('division-by-zero');
  });

  it('ignores a handler whose range does not cover the throwing instruction', () => {
    const error = expectVmError(
      divideWithHandler([handler(0, 1, 4, 'java/lang/ArithmeticException')]),
    );

    expect(error.kind).toBe('division-by-zero');
  });

  it('takes the first matching row, not the most specific one', () => {
    const result = divideWithHandler([
      handler(0, 4, 4),
      handler(0, 4, 0, 'java/lang/ArithmeticException'),
    ]);

    expect(expectCompleted(result).returnValue).toBe(-1);
  });

  it('rejects a handler offset that is not the start of an instruction (JVMS §4.9.1)', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [0x11, 0x00, 0x03, 0x03, 0x6c, 0xac],
            exceptionTable: [handler(0, 5, 1, 'java/lang/ArithmeticException')],
          },
        ],
      }),
    );

    expect(expectVmError(result)).toEqual({
      kind: 'bad-branch-target',
      mnemonic: 'exception handler',
      target: 1,
      offset: 0,
      methodName: 'main',
    });
    expect(result.snapshots).toEqual([]);
  });

  it('enters the handler with the exception alone on the operand stack', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [0x08, 0x04, 0x03, 0x6c, 0xac, 0x4c, 0x02, 0xac],
            maxLocals: 2,
            exceptionTable: [handler(0, 5, 5, 'java/lang/ArithmeticException')],
          },
        ],
      }),
    );
    const snapshots = expectCompleted(result).snapshots;
    const atHandler = snapshots.find((snapshot) => snapshot.callStack.at(-1)?.pc === 5);

    expect(atHandler?.callStack.at(-1)?.operandStack).toHaveLength(1);
    expect(atHandler?.callStack.at(-1)?.operandKinds).toEqual(['external']);
    expect(expectCompleted(result).returnValue).toBe(-1);
  });
});

describe('the objects a machine-raised exception leaves behind', () => {
  it('gives each caught exception the detail that raised it', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [
              ...[0x04, 0xbc, T_INT, 0x4c],
              ...[0x2b, 0x10, 5, 0x2e, 0x57, 0x4d],
              ...[0x2b, 0x10, 6, 0x2e, 0x57, 0x4d],
              ...[0x06, 0xac],
            ],
            maxLocals: 3,
            exceptionTable: [
              handler(4, 10, 10, 'java/lang/ArrayIndexOutOfBoundsException'),
              handler(10, 16, 16, 'java/lang/ArrayIndexOutOfBoundsException'),
            ],
          },
        ],
      }),
    );
    const completed = expectCompleted(result);

    expect(completed.returnValue).toBe(3);
    expect(completed.snapshots.at(-1)?.externals).toEqual([
      {
        className: 'java/lang/ArrayIndexOutOfBoundsException',
        label: 'ArrayIndexOutOfBoundsException',
        detail: 'ArrayIndexOutOfBoundsException: index 5 out of bounds for length 1',
      },
      {
        className: 'java/lang/ArrayIndexOutOfBoundsException',
        label: 'ArrayIndexOutOfBoundsException',
        detail: 'ArrayIndexOutOfBoundsException: index 6 out of bounds for length 1',
      },
    ]);
  });

  it('gives two throws two objects, even when the detail is the same (JVMS §2.12)', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [
              ...[0x04, 0x03, 0x6c, 0x57, 0x4c],
              ...[0x04, 0x03, 0x6c, 0x57, 0x4d],
              ...[0x2b, 0x2c, 0xa5, 0x00, 0x05, 0x03, 0xac, 0x04, 0xac],
            ],
            maxLocals: 3,
            exceptionTable: [
              handler(0, 4, 4, 'java/lang/ArithmeticException'),
              handler(5, 9, 9, 'java/lang/ArithmeticException'),
            ],
          },
        ],
      }),
    );
    const completed = expectCompleted(result);
    const raised = {
      className: 'java/lang/ArithmeticException',
      label: 'ArithmeticException',
      detail: 'ArithmeticException: / by zero',
    };

    expect(completed.returnValue).toBe(0);
    expect(completed.snapshots.at(-1)?.externals).toEqual([raised, raised]);
  });

  it('still gives one object to every ldc of the same String constant', () => {
    const pool = new ConstantPoolBuilder();
    const text = pool.stringEntry('shared');
    const completed = expectCompleted(
      execute(
        syntheticClass({
          pool,
          methods: [
            {
              name: 'main',
              descriptor: '()I',
              code: [0x12, text, 0x12, text, 0xa5, 0x00, 0x05, 0x03, 0xac, 0x04, 0xac],
            },
          ],
        }),
      ),
    );

    expect(completed.returnValue).toBe(1);
    expect(completed.snapshots.at(-1)?.externals).toHaveLength(1);
  });

  it('interns nothing while no handler is found', () => {
    const result = execute(
      syntheticClass({
        methods: [{ name: 'main', descriptor: '()I', code: DIVIDE_BY_ZERO }],
      }),
    );

    expect(expectVmError(result).kind).toBe('division-by-zero');
    expect(result.snapshots.at(-1)?.externals).toEqual([]);
  });
});

describe('an exception nothing catches', () => {
  function uncaughtAcrossTwoFrames(): ReturnType<typeof execute> {
    const pool = new ConstantPoolBuilder();
    const boom = pool.methodref('Synthetic', 'boom', '()I');
    return execute(
      syntheticClass({
        pool,
        methods: [
          { name: 'main', descriptor: '()I', code: [0xb8, 0x00, boom, 0xac] },
          { name: 'boom', descriptor: '()I', code: DIVIDE_BY_ZERO },
        ],
      }),
    );
  }

  it('ends the run and reports the frame that raised it', () => {
    const error = expectVmError(uncaughtAcrossTwoFrames());

    expect(error).toMatchObject({ kind: 'division-by-zero', methodName: 'boom', offset: 2 });
  });

  it('unwinds every frame on the way out, so the last snapshot shows an empty stack', () => {
    const result = uncaughtAcrossTwoFrames();
    const depths = result.snapshots.map((snapshot: Snapshot) => snapshot.callStack.length);

    expect(Math.max(...depths)).toBe(2);
    expect(result.snapshots.length).toBeGreaterThan(2);
  });
});

describe('athrow', () => {
  it('throws the same object again, and a second table row catches it', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [0x04, 0x03, 0x6c, 0xac, 0x4c, 0x2b, 0xbf, 0x4d, 0x05, 0xac],
            maxLocals: 3,
            exceptionTable: [
              handler(0, 4, 4, 'java/lang/ArithmeticException'),
              handler(4, 7, 7, 'java/lang/ArithmeticException'),
            ],
          },
        ],
      }),
    );

    expect(expectCompleted(result).returnValue).toBe(2);
  });

  it('reports the exception as uncaught when the rethrow finds no handler', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [0x04, 0x03, 0x6c, 0xac, 0x4c, 0x2b, 0xbf],
            maxLocals: 2,
            exceptionTable: [handler(0, 4, 4, 'java/lang/ArithmeticException')],
          },
        ],
      }),
    );
    const error = expectVmError(result);

    expect(error).toMatchObject({
      kind: 'uncaught-exception',
      className: 'java/lang/ArithmeticException',
      label: 'ArithmeticException: / by zero',
      offset: 6,
    });
  });

  it('rethrows the exception that was caught, not an earlier one of the same class', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [
              0x04, 0xbc, 0x0a, 0x4c, 0x2b, 0x10, 0x05, 0x2e, 0xac, 0x4d, 0x2b, 0x10, 0x09, 0x2e,
              0xac, 0x4d, 0x2c, 0xbf,
            ],
            maxLocals: 3,
            exceptionTable: [
              handler(4, 8, 9, 'java/lang/ArrayIndexOutOfBoundsException'),
              handler(10, 14, 15, 'java/lang/ArrayIndexOutOfBoundsException'),
            ],
          },
        ],
      }),
    );

    expect(expectVmError(result)).toMatchObject({
      kind: 'uncaught-exception',
      className: 'java/lang/ArrayIndexOutOfBoundsException',
      label: 'ArrayIndexOutOfBoundsException: index 9 out of bounds for length 1',
      offset: 17,
    });
  });

  it('raises NullPointerException when the reference it pops is null (JVMS §6.5)', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            code: [0x01, 0xbf, 0x4c, 0x02, 0xac],
            maxLocals: 2,
            exceptionTable: [handler(0, 2, 2, 'java/lang/NullPointerException')],
          },
        ],
      }),
    );
    const completed = expectCompleted(result);

    expect(completed.returnValue).toBe(-1);
    expect(completed.snapshots.at(-1)?.externals).toEqual([
      {
        className: 'java/lang/NullPointerException',
        label: 'NullPointerException',
        detail: 'NullPointerException: the reference is null',
      },
    ]);
  });

  it('reports the null it could not throw when nothing catches it', () => {
    const error = expectVmError(
      execute(
        syntheticClass({ methods: [{ name: 'main', descriptor: '()I', code: [0x01, 0xbf] }] }),
      ),
    );

    expect(error).toMatchObject({ kind: 'null-reference', offset: 1, methodName: 'main' });
  });

  it('refuses a reference to something on the heap', () => {
    const error = expectVmError(
      execute(
        syntheticClass({
          methods: [{ name: 'main', descriptor: '()I', code: [0x04, 0xbc, T_INT, 0xbf] }],
        }),
      ),
    );

    expect(error).toMatchObject({
      kind: 'invalid-state',
      message: 'athrow needs a throwable on the operand stack, found an unknown object',
    });
  });

  it('refuses an object that is not a throwable', () => {
    const pool = new ConstantPoolBuilder();
    const text = pool.stringEntry('not an exception');
    const error = expectVmError(
      execute(
        syntheticClass({
          pool,
          methods: [{ name: 'main', descriptor: '()I', code: [0x12, text, 0xbf] }],
        }),
      ),
    );

    expect(error.kind).toBe('invalid-state');
    expect(error).toMatchObject({
      message: expect.stringContaining('athrow') as unknown as string,
    });
  });
});

describe('limits that cannot be caught', () => {
  it('does not let a catch-all handler swallow a stack overflow', () => {
    const pool = new ConstantPoolBuilder();
    const self = pool.methodref('Synthetic', 'main', '()I');
    const error = expectVmError(
      execute(
        syntheticClass({
          pool,
          methods: [
            {
              name: 'main',
              descriptor: '()I',
              code: [0xb8, 0x00, self, 0xac, 0x4c, 0x03, 0xac],
              maxLocals: 2,
              exceptionTable: [handler(0, 4, 4)],
            },
          ],
        }),
        { maxSteps: DEFAULT_MAX_CALL_DEPTH * 4 },
      ),
    );

    expect(error.kind).toBe('stack-overflow');
  });

  it('does not let a catch-all handler swallow an out-of-memory', () => {
    const pool = new ConstantPoolBuilder();
    const huge = pool.integer(2_147_483_647);
    const error = expectVmError(
      execute(
        syntheticClass({
          pool,
          methods: [
            {
              name: 'main',
              descriptor: '()I',
              code: [0x12, huge, 0xbc, T_INT, 0xbe, 0xac, 0x4c, 0x03, 0xac],
              maxLocals: 2,
              exceptionTable: [handler(0, 6, 6)],
            },
          ],
        }),
      ),
    );

    expect(error.kind).toBe('out-of-memory');
  });
});

describe('catches', () => {
  it('matches a class against itself and its supertypes', () => {
    for (const type of [
      'java/lang/ArithmeticException',
      'java/lang/RuntimeException',
      'java/lang/Exception',
      'java/lang/Throwable',
    ]) {
      expect(catches(type, 'java/lang/ArithmeticException')).toBe(true);
    }
  });

  it('walks the two-step chain of an index exception', () => {
    const thrown = 'java/lang/ArrayIndexOutOfBoundsException';

    expect(catches('java/lang/IndexOutOfBoundsException', thrown)).toBe(true);
    expect(catches('java/lang/RuntimeException', thrown)).toBe(true);
    expect(catches('java/lang/ArithmeticException', thrown)).toBe(false);
  });

  it('treats a missing handler type as a catch-all', () => {
    expect(catches(undefined, 'java/lang/NullPointerException')).toBe(true);
  });

  it('returns false for a class it does not know', () => {
    expect(catches('com/example/MyException', 'java/lang/ArithmeticException')).toBe(false);
  });
});
