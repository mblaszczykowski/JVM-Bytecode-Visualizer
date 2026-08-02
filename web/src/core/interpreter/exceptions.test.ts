import { describe, expect, it } from 'vitest';

import type { ExceptionTableEntry } from '../classfile';

import { expectCompleted, expectVmError } from './__fixtures__/expect-execution';
import { ConstantPoolBuilder, syntheticClass } from './__fixtures__/synthetic-class';
import { execute } from './interpreter';
import { catches } from './throwable';
import { DEFAULT_MAX_CALL_DEPTH, type Snapshot } from './types';

/**
 * The exception table as the interpreter uses it. `Exceptions.java` next door already proves
 * the everyday shapes against a real JVM; what is left here is what javac will not emit — a
 * handler that catches a class nothing throws, a table with no matching row anywhere on the
 * stack, `athrow` of something that is not throwable — and the two limits that deliberately
 * refuse to be caught.
 */

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
    catchTypeIndex: catchType === undefined ? 0 : 1,
    ...(catchType === undefined ? {} : { catchType }),
  };
}

/** `iconst_1; iconst_0; idiv; ireturn` — offsets 0,1,2,3. The division is at 2. */
const DIVIDE_BY_ZERO: readonly number[] = [0x04, 0x03, 0x6c, 0xac];

/** The handler at offset 4: `iconst_m1 …` needs the exception off the stack first. */
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
          // 0..3 as above, then at 4: astore_1 (the exception), iconst_m1, ireturn.
          code: [...DIVIDE_BY_ZERO, 0x4c, 0x02, 0xac],
          maxLocals,
          exceptionTable: entries,
        },
      ],
    }),
  );
}

describe('the exception table', () => {
  it('catches what the machine raised and carries on from the handler', () => {
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
    // The row covers offset 0 only; the idiv is at 2.
    const error = expectVmError(
      divideWithHandler([handler(0, 1, 4, 'java/lang/ArithmeticException')]),
    );

    expect(error.kind).toBe('division-by-zero');
  });

  it('takes the first matching row, not the most specific one', () => {
    // A catch-all first, then the exact class. Source order is the table order, and Java
    // would have rejected the reverse — but the machine must follow the table, not taste.
    const result = divideWithHandler([
      handler(0, 4, 4),
      handler(0, 4, 0, 'java/lang/ArithmeticException'),
    ]);

    expect(expectCompleted(result).returnValue).toBe(-1);
  });

  it('enters the handler with the exception alone on the operand stack', () => {
    // `iconst_5` leaves a value behind before the division faults; JVMS §2.10 says the
    // handler starts from a stack holding the exception and nothing else.
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            // 0: iconst_5  1: iconst_1  2: iconst_0  3: idiv  4: ireturn
            // 5: (handler) astore_1  6: iconst_m1  7: ireturn
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

describe('an exception nothing catches', () => {
  /** `main` calls `boom`, neither has a handler. */
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

  it('ends the run and blames the frame that raised it', () => {
    const error = expectVmError(uncaughtAcrossTwoFrames());

    expect(error).toMatchObject({ kind: 'division-by-zero', methodName: 'boom', offset: 2 });
  });

  it('unwinds every frame on the way out, so the last snapshot shows an empty stack', () => {
    const result = uncaughtAcrossTwoFrames();
    const depths = result.snapshots.map((snapshot: Snapshot) => snapshot.callStack.length);

    // It really did get two deep, and the history keeps every step up to the fault.
    expect(Math.max(...depths)).toBe(2);
    expect(result.snapshots.length).toBeGreaterThan(2);
  });
});

describe('athrow', () => {
  /**
   * Catch a division by zero, then throw the caught object again. The outer handler is a
   * second row over the `athrow` itself.
   */
  it('throws the same object again, and a further row catches it', () => {
    const result = execute(
      syntheticClass({
        methods: [
          {
            name: 'main',
            descriptor: '()I',
            // 0: iconst_1 1: iconst_0 2: idiv 3: ireturn
            // 4: (handler A) astore_1  5: aload_1  6: athrow
            // 7: (handler B) astore_2  8: iconst_2  9: ireturn
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

/**
 * These two are the visualizer's own limits rather than the program's semantics. A real JVM
 * does let a program catch both, but a handler that swallowed one here would hand the run
 * straight back to the loop that reached it.
 */
describe('the limits that refuse to be caught', () => {
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
              // 0: invokestatic main  3: ireturn   4: (handler) astore_1  5: iconst_0 6: ireturn
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
              // 0: ldc huge  2: newarray int  4: arraylength  5: ireturn
              // 6: (handler) astore_1  7: iconst_0  8: ireturn
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
  it('matches a class against itself and against every supertype it has', () => {
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

  it('treats a missing handler type as the catch-all row it is', () => {
    expect(catches(undefined, 'java/lang/NullPointerException')).toBe(true);
  });

  it('says no to a class it has never heard of', () => {
    expect(catches('com/example/MyException', 'java/lang/ArithmeticException')).toBe(false);
  });
});
