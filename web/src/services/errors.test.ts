import { describe, expect, it } from 'vitest';

import { ClassFileError } from '../core/classfile';
import type { VmError } from '../core/interpreter';

import {
  describeAppError,
  describeCompileFailure,
  toAppError,
  type AppError,
  type CompileFailure,
} from './errors';
import { ExampleLoadError } from './examples';

/** One row per failure the user can actually reach — the wording is part of the contract. */
const CASES: readonly {
  readonly name: string;
  readonly error: AppError;
  readonly severity: string;
  readonly message: string;
}[] = [
  {
    name: 'not a class file',
    error: { kind: 'class-file', detail: { kind: 'bad-magic', offset: 0, found: 0x4e6f7420 } },
    severity: 'error',
    message: 'Not a .class file: expected the 0xcafebabe header, found 0x4e6f7420 (offset 0).',
  },
  {
    name: 'truncated class file',
    error: {
      kind: 'class-file',
      detail: {
        kind: 'truncated',
        offset: 42,
        context: 'constant_pool[7].class_index',
        bytesNeeded: 2,
        bytesAvailable: 1,
      },
    },
    severity: 'error',
    message: 'Truncated file: constant_pool[7].class_index needs 2 B, 1 B available (offset 42).',
  },
  {
    name: 'unsupported opcode on the execution path',
    error: {
      kind: 'vm',
      error: {
        kind: 'unsupported-opcode',
        mnemonic: 'invokevirtual',
        offset: 23,
        methodName: 'main',
      },
    },
    severity: 'error',
    message:
      'Unsupported instruction: invokevirtual (pc 23, method main). This interpreter implements ' +
      'the int-only subset of the JVM instruction set, and invokevirtual is outside it. The ' +
      'history up to this point is still playable.',
  },
  {
    name: 'call outside the executed class',
    error: {
      kind: 'vm',
      error: {
        kind: 'unsupported-call',
        target: 'java/lang/Math.max(II)I',
        offset: 7,
        methodName: 'main',
      },
    },
    severity: 'error',
    message:
      'Unsupported call: java/lang/Math.max(II)I (pc 7, method main). This interpreter resolves ' +
      'calls inside the class it is executing only, and only to its static int methods — there ' +
      'is no Java library behind it. The history up to this point is still playable.',
  },
  {
    name: 'division by zero',
    error: {
      kind: 'vm',
      error: { kind: 'division-by-zero', offset: 14, methodName: 'gcd' },
    },
    severity: 'error',
    message: 'ArithmeticException: / by zero (pc 14, method gcd).',
  },
  {
    name: 'invalid bytecode state',
    error: {
      kind: 'vm',
      error: {
        kind: 'invalid-state',
        message: 'execution ran past the end of main()',
        offset: 9,
        methodName: 'main',
      },
    },
    severity: 'error',
    message:
      'The run could not go on: execution ran past the end of main() (pc 9, method main). The ' +
      'history up to this point is still playable.',
  },
  {
    name: 'runaway recursion',
    error: {
      kind: 'vm',
      error: { kind: 'stack-overflow', limit: 1_500, offset: 10, methodName: 'sum' },
    },
    severity: 'error',
    message:
      'StackOverflowError: too many nested calls — the call stack reached its limit of 1,500 frames (pc 10, method sum). Recursion without a reachable base case ends up here.',
  },
  {
    name: 'branch into the middle of an instruction',
    error: {
      kind: 'vm',
      error: {
        kind: 'bad-branch-target',
        mnemonic: 'goto',
        target: 67,
        offset: 3,
        methodName: 'main',
      },
    },
    severity: 'error',
    message:
      'Invalid branch target: goto jumps to offset 67, which is not the start of an instruction (pc 3, method main).',
  },
  {
    name: 'index past the end of an array',
    error: {
      kind: 'vm',
      error: {
        kind: 'array-index-out-of-bounds',
        index: 5,
        length: 3,
        offset: 21,
        methodName: 'sort',
      },
    },
    severity: 'error',
    message:
      'ArrayIndexOutOfBoundsException: index 5 out of bounds for length 3 (pc 21, method sort). Valid indices run from 0 to 2.',
  },
  {
    name: 'any index into an empty array',
    error: {
      kind: 'vm',
      error: {
        kind: 'array-index-out-of-bounds',
        index: 0,
        length: 0,
        offset: 8,
        methodName: 'sum',
      },
    },
    severity: 'error',
    message:
      'ArrayIndexOutOfBoundsException: index 0 out of bounds for length 0 (pc 8, method sum). The array is empty, so no index is valid.',
  },
  {
    name: 'array allocated with a negative length',
    error: {
      kind: 'vm',
      error: { kind: 'negative-array-size', size: -1, offset: 4, methodName: 'main' },
    },
    severity: 'error',
    message:
      'NegativeArraySizeException: -1 (pc 4, method main). An array cannot be created with a negative length.',
  },
  {
    name: 'array access through a null reference',
    error: { kind: 'vm', error: { kind: 'null-reference', offset: 12, methodName: 'sum' } },
    severity: 'error',
    message:
      'NullPointerException: the reference is null (pc 12, method sum). There is no array behind it to read, write or measure.',
  },
  {
    name: 'array of a type this interpreter has no heap for',
    error: {
      kind: 'vm',
      error: { kind: 'unsupported-array-type', typeName: 'long[]', offset: 3, methodName: 'main' },
    },
    severity: 'error',
    message:
      'Unsupported array type: long[] (pc 3, method main). This interpreter only allocates int arrays.',
  },
  {
    name: 'a field this machine has no object behind',
    error: {
      kind: 'vm',
      error: {
        kind: 'unsupported-field',
        target: 'java/lang/System.in:Ljava/io/InputStream;',
        offset: 3,
        methodName: 'main',
      },
    },
    severity: 'error',
    message:
      'Unsupported field: java/lang/System.in:Ljava/io/InputStream; (pc 3, method main). This ' +
      'interpreter models a short list of external members — System.out among them — and no ' +
      'instance state at all, so there is no object here to read the field from. The history ' +
      'up to this point is still playable.',
  },
  {
    name: 'a pooled constant with no value this machine can hold',
    error: {
      kind: 'vm',
      error: {
        kind: 'unsupported-constant',
        target: 'a Double constant',
        offset: 5,
        methodName: 'main',
      },
    },
    severity: 'error',
    message:
      'Unsupported constant: a Double constant (pc 5, method main). ldc pushes the int and ' +
      'String entries of the constant pool here; the other constant kinds have no value this ' +
      'machine can hold. The history up to this point is still playable.',
  },
  {
    name: 'a class file with nothing this machine can run',
    error: { kind: 'no-entry-point', className: 'Library' },
    severity: 'info',
    message:
      'Library has no method this machine can start from — a run needs a static method it can ' +
      'enter with no argument values. Nothing is missing from the file itself: the constant ' +
      'pool, the fields and every method listing are on screen to read.',
  },
  {
    name: 'step limit',
    error: { kind: 'step-limit', limit: 20_000 },
    severity: 'warning',
    message:
      'Stopped after 20,000 steps — the program probably does not terminate. Showing the history up to this point.',
  },
  {
    name: 'oversized upload',
    error: {
      kind: 'file-too-large',
      fileName: 'Huge.class',
      bytes: 1_500_000,
      limit: 512 * 1024,
    },
    severity: 'error',
    message:
      '"Huge.class" is 1.4 MiB — the upload limit is 512 KiB. Class files this large are not hand-written Java.',
  },
  {
    name: 'unreadable upload',
    error: { kind: 'file-unreadable', fileName: 'Factorial.class', reason: 'permission denied' },
    severity: 'error',
    message: 'Could not read "Factorial.class": permission denied.',
  },
  {
    name: 'download failure',
    error: {
      kind: 'example-load',
      detail: { kind: 'http', url: '/examples/Gcd.class', status: 503 },
    },
    severity: 'error',
    message: 'Could not download /examples/Gcd.class: the server answered 503.',
  },
  {
    name: 'anything unforeseen',
    error: { kind: 'unexpected', reason: 'out of memory' },
    severity: 'error',
    message: 'Unexpected failure: out of memory.',
  },
];

describe('error messages', () => {
  it.each(CASES)('$name', ({ error, severity, message }) => {
    const presentation = describeAppError(error);

    expect(presentation.severity).toBe(severity);
    expect(presentation.message).toBe(message);
  });

  it('names the offending instruction and method for every VM error kind', () => {
    const kinds: readonly VmError['kind'][] = [
      'unsupported-opcode',
      'unsupported-call',
      'division-by-zero',
      'invalid-state',
      'stack-overflow',
      'bad-branch-target',
      'array-index-out-of-bounds',
      'negative-array-size',
      'null-reference',
      'unsupported-array-type',
      'unsupported-field',
      'unsupported-constant',
    ];
    const covered = CASES.filter((testCase) => testCase.error.kind === 'vm').map(
      (testCase) => (testCase.error as { error: VmError }).error.kind,
    );

    expect(new Set(covered)).toEqual(new Set(kinds));
  });
});

describe('toAppError', () => {
  it('keeps the typed detail of a class file error', () => {
    const error = new ClassFileError({ kind: 'bad-magic', offset: 0, found: 0 });

    expect(toAppError(error)).toEqual({ kind: 'class-file', detail: error.detail });
  });

  it('keeps the typed detail of a download failure', () => {
    const error = new ExampleLoadError({ kind: 'http', url: '/examples/x', status: 500 });

    expect(toAppError(error)).toEqual({ kind: 'example-load', detail: error.detail });
  });

  it('falls back to the message of anything else', () => {
    expect(toAppError(new RangeError('boom'))).toEqual({ kind: 'unexpected', reason: 'boom' });
    expect(toAppError('boom')).toEqual({ kind: 'unexpected', reason: 'boom' });
  });
});

describe('describeCompileFailure', () => {
  it('asks for patience rather than blaming the source when the limit is hit', () => {
    expect(describeCompileFailure({ kind: 'rate-limited' })).toEqual({
      severity: 'warning',
      message: 'The compiler is busy (rate limit). Try again in a minute.',
    });
  });

  it('says the rest of the application still works when the service is gone', () => {
    const presentation = describeCompileFailure({
      kind: 'unavailable',
      reason: { kind: 'network', reason: 'Failed to fetch' },
    });

    expect(presentation.severity).toBe('error');
    expect(presentation.message).toBe(
      'Could not reach the compile service: Failed to fetch. The examples and .class uploads still work.',
    );
  });

  it('names the status, the deadline and an answer it cannot read', () => {
    const message = (failure: CompileFailure) => describeCompileFailure(failure).message;

    expect(message({ kind: 'unavailable', reason: { kind: 'http', status: 502 } })).toContain(
      'answered 502',
    );
    expect(message({ kind: 'unavailable', reason: { kind: 'timeout', ms: 30_000 } })).toContain(
      'within 30 s',
    );
    expect(
      message({
        kind: 'unavailable',
        reason: { kind: 'invalid-response', reason: 'className: required' },
      }),
    ).toContain('className: required');
  });
});
