import { describe, expect, it } from 'vitest';

import { ClassFileError } from '../core/classfile';
import type { VmError } from '../core/interpreter';

import { describeAppError, toAppError, type AppError } from './errors';
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
      'Unsupported instruction: invokevirtual (pc 23, method main). This interpreter runs the int-only subset of the JVM instruction set.',
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
      'Unsupported call: java/lang/Math.max(II)I (pc 7, method main). Only static int methods of the class being executed can be called.',
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
    message: 'Invalid bytecode state: execution ran past the end of main() (pc 9, method main).',
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
