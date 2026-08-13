import { describe, expect, it } from 'vitest';

import { AccessFlag, ClassFileError, type FieldInfo } from '../../core/classfile';
import {
  execute,
  EXTERNAL_METHODS,
  memberKey,
  type ExecutionResult,
  type VmError,
} from '../../core/interpreter';
import {
  expectCompleted,
  expectVmError,
} from '../../core/interpreter/__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
  type SyntheticMethod,
} from '../../core/interpreter/__fixtures__/synthetic-class';

import { COMPILER_BUSY, type CompileDiagnostic } from './compile-client';
import {
  describeAppError,
  describeCompileDiagnostics,
  describeCompileFailure,
  toAppError,
  type AppError,
  type CompileFailure,
} from './errors';
import { ExampleLoadError } from './examples';

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
      'StackOverflowError: the call stack reached its limit of 1,500 frames (pc 10, method sum). Recursion without a reachable base case ends up here.',
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
    name: 'an array larger than the whole heap',
    error: {
      kind: 'vm',
      error: {
        kind: 'out-of-memory',
        resource: 'heap',
        requested: 2_147_483_647,
        limit: 8_000_000,
        offset: 2,
        methodName: 'main',
      },
    },
    severity: 'error',
    message:
      'OutOfMemoryError (pc 2, method main). The program asked for 2,147,483,647 array ' +
      'elements at once, and this machine holds at most 8,000,000. ' +
      'The history up to this point is still playable.',
  },
  {
    name: 'a run whose array writes outgrow the recording budget',
    error: {
      kind: 'vm',
      error: {
        kind: 'out-of-memory',
        resource: 'history',
        requested: 24_010_000,
        limit: 24_000_000,
        offset: 31,
        methodName: 'sort',
      },
    },
    severity: 'error',
    message:
      'OutOfMemoryError (pc 31, method sort). Recording this run would have cost 24,010,000 ' +
      'copied values, and the budget is 24,000,000. Every step keeps its own copy of the heap, ' +
      'the console lines and the standard-library objects the run has interned, so a large ' +
      'array written in a loop, or a loop that prints, costs far more than the values ' +
      'themselves. The history up to this point is still playable.',
  },
  {
    name: 'an exception nothing on the call stack caught',
    error: {
      kind: 'vm',
      error: {
        kind: 'uncaught-exception',
        className: 'java/lang/ArithmeticException',
        label: 'ArithmeticException: / by zero',
        offset: 12,
        methodName: 'divide',
      },
    },
    severity: 'error',
    message:
      'ArithmeticException: / by zero (pc 12, method divide). Nothing on the call stack ' +
      'caught it, so every frame was unwound and the run ended, exactly as a real JVM would ' +
      'end it. Scrub back to watch the stack unwind. ' +
      'The history up to this point is still playable.',
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
      'Library has no method this machine can start from: a run needs a static method it can ' +
      'enter with no argument values. Nothing is missing from the file itself; the constant ' +
      'pool, the fields and every method listing are on screen to read.',
  },
  {
    name: 'step limit',
    error: { kind: 'step-limit', limit: 20_000 },
    severity: 'warning',
    message:
      'Stopped after 20,000 steps: the program probably does not terminate. Showing the history up to this point.',
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
      '"Huge.class" is 1.4 MiB; the upload limit is 512 KiB. Class files this large are not hand-written Java.',
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

const VALUE_FIELD: FieldInfo = { name: 'value', descriptor: 'I', accessFlags: AccessFlag.Public };

const CONSTRUCTOR: SyntheticMethod = {
  name: '<init>',
  descriptor: '()V',
  code: [0xb1],
  accessFlags: AccessFlag.Public,
};

const SIZE: SyntheticMethod = {
  name: 'size',
  descriptor: '()I',
  code: [0x03, 0xac],
  accessFlags: AccessFlag.Public,
};

function u2(index: number): readonly number[] {
  return [(index >> 8) & 0xff, index & 0xff];
}

function run(
  pool: ConstantPoolBuilder,
  code: readonly number[],
  methods: readonly SyntheticMethod[] = [],
): ExecutionResult {
  return execute(
    syntheticClass({
      pool,
      fields: [VALUE_FIELD],
      methods: [{ name: 'main', descriptor: '()I', code }, ...methods],
    }),
  );
}

function bannerFor(error: VmError): string {
  return describeAppError({ kind: 'vm', error }).message;
}

function callOutsideTheLoadedClass(): VmError {
  const pool = new ConstantPoolBuilder();
  return expectVmError(
    run(pool, [0xb8, ...u2(pool.methodref('java/lang/Math', 'max', '(JJ)J')), 0xac]),
  );
}

function fieldOfAnotherClass(): VmError {
  const pool = new ConstantPoolBuilder();
  return expectVmError(
    run(pool, [0x01, 0xb4, ...u2(pool.fieldref('java/awt/Point', 'x', 'I')), 0xac]),
  );
}

function fieldReadThroughNull(): VmError {
  const pool = new ConstantPoolBuilder();
  return expectVmError(
    run(pool, [0x01, 0xb4, ...u2(pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I')), 0xac]),
  );
}

const RAISED_BY_A_RUN: readonly VmError[] = [
  callOutsideTheLoadedClass(),
  fieldReadThroughNull(),
  fieldOfAnotherClass(),
];

describe('error messages', () => {
  it.each(CASES)('$name', ({ error, severity, message }) => {
    const presentation = describeAppError(error);

    expect(presentation.severity).toBe(severity);
    expect(presentation.message).toBe(message);
  });

  it('names the offending instruction and method for every VM error kind', () => {
    const covered = [
      ...CASES.filter((testCase) => testCase.error.kind === 'vm').map(
        (testCase) => (testCase.error as { error: VmError }).error.kind,
      ),
      ...RAISED_BY_A_RUN.map((error) => error.kind),
    ];

    expect(new Set(covered)).toEqual(new Set(Object.keys(VM_ERROR_KINDS)));
  });
});

const VM_ERROR_KINDS: Readonly<Record<VmError['kind'], true>> = {
  'unsupported-opcode': true,
  'unsupported-call': true,
  'division-by-zero': true,
  'invalid-state': true,
  'stack-overflow': true,
  'bad-branch-target': true,
  'array-index-out-of-bounds': true,
  'negative-array-size': true,
  'null-reference': true,
  'unsupported-array-type': true,
  'out-of-memory': true,
  'uncaught-exception': true,
  'unsupported-field': true,
  'unsupported-constant': true,
};

const MODELLED_CALLS: readonly { readonly key: string; readonly named: string }[] = [
  { key: memberKey('java/lang/Math', 'max', '(II)I'), named: 'Math.max' },
  { key: memberKey('java/lang/Math', 'min', '(II)I'), named: 'Math.min' },
  { key: memberKey('java/lang/Math', 'abs', '(I)I'), named: 'Math.abs' },
  { key: memberKey('java/lang/Math', 'floorDiv', '(II)I'), named: 'Math.floorDiv' },
  { key: memberKey('java/lang/Math', 'floorMod', '(II)I'), named: 'Math.floorMod' },
  { key: memberKey('java/io/PrintStream', 'print', '(I)V'), named: 'print' },
  { key: memberKey('java/io/PrintStream', 'println', '(I)V'), named: 'println' },
];

describe('the banner for a call this machine cannot resolve', () => {
  it('names the target, the instruction and the method of the call that stopped the run', () => {
    const error = callOutsideTheLoadedClass();
    const presentation = describeAppError({ kind: 'vm', error });

    expect(error.kind).toBe('unsupported-call');
    expect(presentation.severity).toBe('error');
    expect(presentation.message).toContain('Unsupported call: java/lang/Math.max(JJ)J');
    expect(presentation.message).toContain(
      `(pc ${String(error.offset)}, method ${error.methodName})`,
    );
  });

  it('covers allocating another class, which stops in the same place', () => {
    const pool = new ConstantPoolBuilder();
    const error = expectVmError(
      run(pool, [0xbb, ...u2(pool.classEntry('java/util/ArrayList')), 0x57, 0x03, 0xac]),
    );
    const message = bannerFor(error);

    expect(error.kind).toBe('unsupported-call');
    expect(message).toContain('Unsupported call: new java/util/ArrayList');
    expect(message).toContain('allocations');
  });

  it('offers only standard-library methods this machine really models', () => {
    const message = bannerFor(callOutsideTheLoadedClass());

    for (const { key, named } of MODELLED_CALLS) {
      expect(EXTERNAL_METHODS.has(key), key).toBe(true);
      expect(message).toContain(named);
    }
  });

  it('is not raised for the modelled calls it offers: Math.max and println', () => {
    const pool = new ConstantPoolBuilder();
    const result = run(pool, [
      ...[0xb2, ...u2(pool.fieldref('java/lang/System', 'out', 'Ljava/io/PrintStream;'))],
      ...[0x10, 7, 0xb6, ...u2(pool.methodref('java/io/PrintStream', 'println', '(I)V'))],
      ...[0x04, 0x10, 9, 0xb8, ...u2(pool.methodref('java/lang/Math', 'max', '(II)I'))],
      0xac,
    ]);

    const completed = expectCompleted(result);
    expect(completed.returnValue).toBe(9);
    expect(completed.snapshots.at(-1)?.consoleOutput).toEqual(['7']);
  });

  it('is not raised for a constructor or an instance method, which it offers too', () => {
    const pool = new ConstantPoolBuilder();
    const value = pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I');
    const result = run(
      pool,
      [
        ...[0xbb, ...u2(pool.classEntry(SYNTHETIC_CLASS_NAME)), 0x59],
        ...[0xb7, ...u2(pool.methodref(SYNTHETIC_CLASS_NAME, '<init>', '()V'))],
        ...[0x59, 0x10, 9, 0xb5, ...u2(value)],
        ...[0xb6, ...u2(pool.methodref(SYNTHETIC_CLASS_NAME, 'readValue', '()I'))],
        0xac,
      ],
      [
        CONSTRUCTOR,
        {
          name: 'readValue',
          descriptor: '()I',
          accessFlags: AccessFlag.Public,
          code: [0x2a, 0xb4, ...u2(value), 0xac],
        },
      ],
    );

    expect(expectCompleted(result).returnValue).toBe(9);
  });
});

const DEREFERENCES: readonly {
  readonly site: string;
  readonly promise: string;
  readonly code: (pool: ConstantPoolBuilder) => readonly number[];
  readonly methods?: readonly SyntheticMethod[];
}[] = [
  {
    site: 'reading a field',
    promise: 'no field to read or write',
    code: (pool) => [0x01, 0xb4, ...u2(pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I')), 0xac],
  },
  {
    site: 'writing a field',
    promise: 'no field to read or write',
    code: (pool) => [
      ...[0x01, 0x04, 0xb5, ...u2(pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I'))],
      ...[0x03, 0xac],
    ],
  },
  {
    site: 'indexing an array',
    promise: 'no array to index or measure',
    code: () => [0x01, 0x03, 0x2e, 0xac],
  },
  {
    site: 'measuring an array',
    promise: 'no array to index or measure',
    code: () => [0x01, 0xbe, 0xac],
  },
  {
    site: 'calling a method',
    promise: 'no method to call',
    code: (pool) => [0x01, 0xb6, ...u2(pool.methodref(SYNTHETIC_CLASS_NAME, 'size', '()I')), 0xac],
    methods: [SIZE],
  },
];

describe('the NullPointerException banner', () => {
  it.each(DEREFERENCES)('covers $site through a null reference', ({ promise, code, methods }) => {
    const pool = new ConstantPoolBuilder();
    const error = expectVmError(run(pool, code(pool), methods));
    const message = bannerFor(error);

    expect(error.kind).toBe('null-reference');
    expect(message).toContain(
      `NullPointerException: the reference is null (pc ${String(error.offset)}, method main)`,
    );
    expect(message).toContain(promise);
  });
});

describe('the banner for a field this machine cannot reach', () => {
  it('names the field of the other class that stopped the run', () => {
    const error = fieldOfAnotherClass();
    const presentation = describeAppError({ kind: 'vm', error });

    expect(error.kind).toBe('unsupported-field');
    expect(presentation.severity).toBe('error');
    expect(presentation.message).toContain('Unsupported field: java/awt/Point.x:I');
    expect(presentation.message).toContain(
      `(pc ${String(error.offset)}, method ${error.methodName})`,
    );
  });

  it('is not raised for a field the loaded class declares, which it offers instead', () => {
    const pool = new ConstantPoolBuilder();
    const value = pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I');
    const result = run(
      pool,
      [
        ...[0xbb, ...u2(pool.classEntry(SYNTHETIC_CLASS_NAME)), 0x59],
        ...[0xb7, ...u2(pool.methodref(SYNTHETIC_CLASS_NAME, '<init>', '()V'))],
        ...[0x59, 0x10, 4, 0xb5, ...u2(value)],
        ...[0xb4, ...u2(value), 0xac],
      ],
      [CONSTRUCTOR],
    );

    expect(expectCompleted(result).returnValue).toBe(4);
    expect(bannerFor(fieldOfAnotherClass())).toContain('the loaded class declares');
  });

  it('is not raised for System.out, the standard-library static it names', () => {
    const pool = new ConstantPoolBuilder();
    const out = pool.fieldref('java/lang/System', 'out', 'Ljava/io/PrintStream;');
    const result = run(pool, [0xb2, ...u2(out), 0x57, 0x03, 0xac]);

    expect(expectCompleted(result).returnValue).toBe(0);
    expect(bannerFor(fieldOfAnotherClass())).toContain('System.out');
  });

  it('is raised for a static this machine does not model', () => {
    const pool = new ConstantPoolBuilder();
    const error = expectVmError(
      run(pool, [
        ...[0xb2, ...u2(pool.fieldref('java/lang/System', 'in', 'Ljava/io/InputStream;'))],
        ...[0x57, 0x03, 0xac],
      ]),
    );

    expect(error.kind).toBe('unsupported-field');
    expect(bannerFor(error)).toContain('java/lang/System.in:Ljava/io/InputStream;');
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
  it('repeats the limit the service named and the wait it asked for', () => {
    expect(
      describeCompileFailure({
        kind: 'rate-limited',
        service: {
          code: 'rate-limit-exceeded',
          message: 'at most 30 requests per minute are allowed',
          retryAfterSeconds: 60,
        },
      }),
    ).toEqual({
      severity: 'warning',
      message:
        'The compile service is limiting how often this browser may compile: at most 30 ' +
        'requests per minute are allowed. Try again in 60 s. The examples and .class uploads ' +
        'still work.',
    });
  });

  it('asks for patience rather than blaming the source when the service sent no document', () => {
    expect(describeCompileFailure({ kind: 'rate-limited' })).toEqual({
      severity: 'warning',
      message:
        'The compile service is limiting how often this browser may compile. Try again in a ' +
        'minute. The examples and .class uploads still work.',
    });
  });

  it('treats a compiler at capacity as a wait, not as a broken service', () => {
    expect(
      describeCompileFailure({
        kind: 'unavailable',
        reason: {
          kind: 'http',
          status: 503,
          service: {
            code: COMPILER_BUSY,
            message: 'the compile service is at capacity, retry in a moment',
            retryAfterSeconds: 5,
          },
        },
      }),
    ).toEqual({
      severity: 'warning',
      message:
        'The compile service is at capacity and did not start another compilation. Try again ' +
        'in 5 s. Nothing is wrong with the source. The examples and .class uploads still work.',
    });
  });

  it('reports a compiler that could not run at all as the failure it is', () => {
    expect(
      describeCompileFailure({
        kind: 'unavailable',
        reason: {
          kind: 'http',
          status: 503,
          service: {
            code: 'compiler-unavailable',
            message: 'the compiler could not be run; retry in a moment',
            retryAfterSeconds: 5,
          },
        },
      }),
    ).toEqual({
      severity: 'error',
      message:
        'The compile service answered 503 (compiler-unavailable): the compiler could not be ' +
        'run; retry in a moment. Try again in 5 s. The examples and .class uploads still work.',
    });
  });

  it('passes on a coded failure that carries no wait', () => {
    expect(
      describeCompileFailure({
        kind: 'unavailable',
        reason: {
          kind: 'http',
          status: 500,
          service: {
            code: 'internal-error',
            message: 'the service failed to handle this request',
            retryAfterSeconds: undefined,
          },
        },
      }).message,
    ).toBe(
      'The compile service answered 500 (internal-error): the service failed to handle this ' +
        'request. The examples and .class uploads still work.',
    );
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

describe('describeCompileDiagnostics', () => {
  const unchecked: CompileDiagnostic = {
    line: 5,
    column: 9,
    kind: 'warning',
    message: 'unchecked call to add(int,int)',
  };

  const deprecated: CompileDiagnostic = {
    line: 11,
    column: 20,
    kind: 'warning',
    message: 'Integer(int) in Integer has been deprecated and marked for removal',
  };

  const note: CompileDiagnostic = {
    line: undefined,
    column: undefined,
    kind: 'note',
    message: 'some input files use unchecked or unsafe operations',
  };

  function messageFor(diagnostics: readonly CompileDiagnostic[]): string {
    const presentation = describeCompileDiagnostics(diagnostics);
    if (presentation === undefined) {
      throw new Error('javac said something about this compile, so there should be a notice');
    }
    return presentation.message;
  }

  it('has nothing to say about a compile javac made no remark on', () => {
    expect(describeCompileDiagnostics([])).toBeUndefined();
  });

  it('repeats the single warning and says the class still ran', () => {
    expect(describeCompileDiagnostics([unchecked])).toEqual({
      severity: 'warning',
      message:
        'javac compiled the class with 1 warning at line 5: unchecked call to add(int,int). ' +
        'Warnings do not stop a compile, so the class it produced is the one on screen.',
    });
  });

  it('counts the warnings and quotes the first of them', () => {
    expect(messageFor([unchecked, deprecated])).toContain(
      'with 2 warnings, the first at line 5: unchecked call to add(int,int).',
    );
  });

  it('leaves out a position javac did not give', () => {
    expect(messageFor([{ ...unchecked, line: undefined }])).toContain(
      'with 1 warning: unchecked call to add(int,int).',
    );
  });

  it('reports a note as a note, below the severity of a warning', () => {
    expect(describeCompileDiagnostics([note])).toEqual({
      severity: 'info',
      message:
        'javac compiled the class with 1 note: some input files use unchecked or unsafe ' +
        'operations. Notes do not stop a compile, so the class it produced is the one on screen.',
    });
  });

  it('passes over the notes when there is a warning to report', () => {
    expect(describeCompileDiagnostics([note, unchecked])?.severity).toBe('warning');
    expect(messageFor([note, unchecked])).toContain('with 1 warning at line 5');
  });
});
