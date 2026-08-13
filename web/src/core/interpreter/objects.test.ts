import { describe, expect, it } from 'vitest';

import { AccessFlag, type ExceptionTableEntry, type FieldInfo } from '../classfile';
import { expectCompleted, expectVmError } from './__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
  type SyntheticMethod,
} from './__fixtures__/synthetic-class';
import { execute } from './interpreter';
import type { ExecutionResult, HeapObject, Snapshot } from './types';

const T_INT = 0x0a;

const VALUE_FIELD: FieldInfo = { name: 'value', descriptor: 'I', accessFlags: AccessFlag.Public };
const NEXT_FIELD: FieldInfo = {
  name: 'next',
  descriptor: `L${SYNTHETIC_CLASS_NAME};`,
  accessFlags: AccessFlag.Public,
};
const COUNTER_FIELD: FieldInfo = {
  name: 'counter',
  descriptor: 'I',
  accessFlags: AccessFlag.Public | AccessFlag.Static,
};

function u2(index: number): readonly number[] {
  return [(index >> 8) & 0xff, index & 0xff];
}

interface Program {
  readonly pool: ConstantPoolBuilder;
  readonly code: readonly number[];
  readonly descriptor?: string;
  readonly fields?: readonly FieldInfo[];
  readonly methods?: readonly SyntheticMethod[];
  readonly maxLocals?: number;
  readonly exceptionTable?: readonly ExceptionTableEntry[];
}

function run({
  pool,
  code,
  descriptor = '()I',
  fields = [VALUE_FIELD],
  methods = [],
  maxLocals = 4,
  exceptionTable,
}: Program): ExecutionResult {
  return execute(
    syntheticClass({
      pool,
      fields,
      methods: [
        {
          name: 'main',
          descriptor,
          code,
          maxLocals,
          ...(exceptionTable ? { exceptionTable } : {}),
        },
        ...methods,
      ],
    }),
  );
}

const CONSTRUCTOR: SyntheticMethod = {
  name: '<init>',
  descriptor: '()V',
  code: [0xb1],
  accessFlags: AccessFlag.Public,
};

function allocate(pool: ConstantPoolBuilder): readonly number[] {
  return [
    0xbb,
    ...u2(pool.classEntry(SYNTHETIC_CLASS_NAME)),
    0x59,
    0xb7,
    ...u2(pool.methodref(SYNTHETIC_CLASS_NAME, '<init>', '()V')),
  ];
}

function instanceAt(snapshot: Snapshot | undefined, handle: number): HeapObject | undefined {
  return snapshot?.heap?.[handle];
}

describe('execute: objects of the loaded class', () => {
  it('runs new, invokespecial, putfield and getfield end to end', () => {
    const pool = new ConstantPoolBuilder();
    const value = pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I');
    const result = run({
      pool,
      methods: [CONSTRUCTOR],
      code: [
        ...allocate(pool),
        ...[0x4c, 0x2b, 0x10, 7],
        ...[0xb5, ...u2(value)],
        ...[0x2b, 0xb4, ...u2(value)],
        0xac,
      ],
    });

    expect(expectCompleted(result).returnValue).toBe(7);
  });

  it('gives every declared instance field its default and records the object', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      fields: [VALUE_FIELD, NEXT_FIELD, COUNTER_FIELD],
      methods: [CONSTRUCTOR],
      code: [...allocate(pool), 0x4c, 0x03, 0xac],
    });
    const snapshots = expectCompleted(result).snapshots;

    expect(instanceAt(snapshots.at(-1), 0)).toEqual({
      kind: 'instance',
      className: SYNTHETIC_CLASS_NAME,
      fields: [
        { name: 'value', descriptor: 'I', value: 0, kind: 'int' },
        { name: 'next', descriptor: `L${SYNTHETIC_CLASS_NAME};`, value: -1, kind: 'ref' },
      ],
    });
  });

  it('shares the frozen instance between steps that did not write to it', () => {
    const pool = new ConstantPoolBuilder();
    const value = pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I');
    const result = run({
      pool,
      methods: [CONSTRUCTOR],
      code: [...allocate(pool), 0x4c, 0x2b, 0x04, 0xb5, ...u2(value), 0x03, 0x57, 0x03, 0xac],
    });
    const snapshots = expectCompleted(result).snapshots;
    const written = snapshots.findIndex(
      (snapshot) => snapshot.currentInstruction?.mnemonic === 'iconst_0',
    );

    expect(instanceAt(snapshots[written], 0)).toMatchObject({
      fields: [{ name: 'value', value: 1, kind: 'int' }],
    });
    expect(instanceAt(snapshots[written], 0)).toBe(instanceAt(snapshots[written + 1], 0));
  });

  it('passes the receiver as local 0 of the called instance method', () => {
    const pool = new ConstantPoolBuilder();
    const value = pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I');
    const readValue = pool.methodref(SYNTHETIC_CLASS_NAME, 'readValue', '()I');
    const result = run({
      pool,
      methods: [
        CONSTRUCTOR,
        {
          name: 'readValue',
          descriptor: '()I',
          accessFlags: AccessFlag.Public,
          code: [0x2a, 0xb4, ...u2(value), 0xac],
        },
      ],
      code: [
        ...allocate(pool),
        ...[0x4c, 0x2b, 0x10, 9],
        ...[0xb5, ...u2(value)],
        ...[0x2b, 0xb6, ...u2(readValue)],
        0xac,
      ],
    });

    expect(expectCompleted(result).returnValue).toBe(9);
  });

  it('refuses to allocate a class other than the one it is executing', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      code: [0xbb, ...u2(pool.classEntry('java/util/ArrayList')), 0x57, 0x03, 0xac],
    });

    expect(expectVmError(result)).toMatchObject({
      kind: 'unsupported-call',
      target: 'new java/util/ArrayList',
    });
  });

  it('refuses a field of another class', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      code: [0x01, 0xb4, ...u2(pool.fieldref('java/awt/Point', 'x', 'I')), 0xac],
    });

    expect(expectVmError(result)).toMatchObject({
      kind: 'unsupported-field',
      target: 'java/awt/Point.x:I',
    });
  });
});

describe('execute: faults on the member access paths', () => {
  it('raises NullPointerException for getfield on a null reference', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      code: [0x01, 0xb4, ...u2(pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I')), 0xac],
    });

    expect(expectVmError(result)).toMatchObject({ kind: 'null-reference', offset: 1 });
  });

  it('raises NullPointerException for putfield on a null reference', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      code: [
        ...[0x01, 0x04, 0xb5],
        ...u2(pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I')),
        0x03,
        0xac,
      ],
    });

    expect(expectVmError(result)).toMatchObject({ kind: 'null-reference', offset: 2 });
  });

  it('raises NullPointerException for a call on a null receiver', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      methods: [
        { name: 'size', descriptor: '()I', accessFlags: AccessFlag.Public, code: [0x03, 0xac] },
      ],
      code: [0x01, 0xb6, ...u2(pool.methodref(SYNTHETIC_CLASS_NAME, 'size', '()I')), 0xac],
    });

    expect(expectVmError(result)).toMatchObject({
      kind: 'null-reference',
      offset: 1,
      methodName: 'main',
    });
  });

  it('lets a handler catch the NullPointerException a null receiver raises', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      maxLocals: 2,
      methods: [
        { name: 'size', descriptor: '()I', accessFlags: AccessFlag.Public, code: [0x03, 0xac] },
      ],
      code: [
        ...[0x01, 0xb6, ...u2(pool.methodref(SYNTHETIC_CLASS_NAME, 'size', '()I')), 0xac],
        ...[0x4c, 0x05, 0xac],
      ],
      exceptionTable: [
        { startPc: 0, endPc: 4, handlerPc: 5, catchType: 'java/lang/NullPointerException' },
      ],
    });
    const completed = expectCompleted(result);

    expect(completed.returnValue).toBe(2);
    expect(completed.snapshots.at(-1)?.externals).toEqual([
      {
        className: 'java/lang/NullPointerException',
        label: 'NullPointerException',
        detail: 'NullPointerException: the reference is null',
      },
    ]);
  });

  it('stops when a field is reached through a reference to an array', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      code: [
        ...[0x04, 0xbc, T_INT],
        ...[0xb4, ...u2(pool.fieldref(SYNTHETIC_CLASS_NAME, 'value', 'I'))],
        0xac,
      ],
    });

    expect(expectVmError(result)).toMatchObject({
      kind: 'invalid-state',
      message: 'field value was reached through a reference to an array',
    });
  });

  it('stops when the class has no field of that name', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      methods: [CONSTRUCTOR],
      code: [
        ...allocate(pool),
        ...[0xb4, ...u2(pool.fieldref(SYNTHETIC_CLASS_NAME, 'missing', 'I'))],
        0xac,
      ],
    });

    expect(expectVmError(result)).toMatchObject({
      kind: 'invalid-state',
      message: `${SYNTHETIC_CLASS_NAME} has no field named missing`,
    });
  });

  it('stops when an array instruction is applied to an instance', () => {
    const pool = new ConstantPoolBuilder();
    const result = run({
      pool,
      methods: [CONSTRUCTOR],
      code: [...allocate(pool), 0xbe, 0xac],
    });

    expect(expectVmError(result)).toMatchObject({
      kind: 'invalid-state',
      message: `an array instruction was applied to an instance of ${SYNTHETIC_CLASS_NAME}`,
    });
  });

  it('refuses a static call to an instance method and the reverse', () => {
    const pool = new ConstantPoolBuilder();
    const size = pool.methodref(SYNTHETIC_CLASS_NAME, 'size', '()I');
    const shapes = [
      { code: [0xb8, ...u2(size), 0xac], accessFlags: AccessFlag.Public },
      { code: [0x01, 0xb6, ...u2(size), 0xac], accessFlags: AccessFlag.Static },
    ];

    for (const { code, accessFlags } of shapes) {
      const result = run({
        pool,
        code,
        methods: [{ name: 'size', descriptor: '()I', accessFlags, code: [0x03, 0xac] }],
      });

      expect(expectVmError(result)).toMatchObject({
        kind: 'unsupported-call',
        target: `${SYNTHETIC_CLASS_NAME}.size()I`,
      });
    }
  });
});
