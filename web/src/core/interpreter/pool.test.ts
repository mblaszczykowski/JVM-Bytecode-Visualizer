import { describe, expect, it } from 'vitest';

import { ConstantTag } from '../classfile';
import { ConstantPoolBuilder, SYNTHETIC_CLASS_NAME } from './__fixtures__/synthetic-class';
import { isVmFault } from './errors';
import {
  callTarget,
  classNameAt,
  describeConstant,
  fieldKind,
  parameterKinds,
  resolveMemberReference,
  resolveMethodref,
  utf8,
} from './pool';
import type { VmFaultDetail } from './types';

function faultFrom(resolve: () => unknown): VmFaultDetail {
  let caught: unknown;
  try {
    resolve();
  } catch (error) {
    caught = error;
  }
  if (!isVmFault(caught)) {
    throw new Error('expected the resolution to throw a VmFault');
  }
  return caught.detail;
}

function notA(index: number, expected: string): VmFaultDetail {
  return {
    kind: 'invalid-state',
    message: `constant pool entry #${String(index)} is not a ${expected}`,
  };
}

describe('utf8', () => {
  it('reads the string of a Utf8 entry', () => {
    const pool = new ConstantPoolBuilder();
    const index = pool.utf8('java/lang/String');

    expect(utf8(pool.build(), index)).toBe('java/lang/String');
  });

  it.each([
    { case: 'another tag', build: (pool: ConstantPoolBuilder) => pool.integer(7) },
    { case: 'nothing at all', build: () => 42 },
  ])('rejects an index naming $case', ({ build }) => {
    const pool = new ConstantPoolBuilder();
    const index = build(pool);

    expect(faultFrom(() => utf8(pool.build(), index))).toEqual(notA(index, 'Utf8'));
  });
});

describe('classNameAt', () => {
  it('reads the name a Class entry points at', () => {
    const pool = new ConstantPoolBuilder();
    const index = pool.classEntry('java/lang/Object');

    expect(classNameAt(pool.build(), index)).toBe('java/lang/Object');
  });

  it('rejects an index that is not a Class', () => {
    const pool = new ConstantPoolBuilder();
    const index = pool.utf8('java/lang/Object');

    expect(faultFrom(() => classNameAt(pool.build(), index))).toEqual(notA(index, 'Class'));
  });

  it('rejects a Class whose name_index is not a Utf8', () => {
    const pool = new ConstantPoolBuilder();
    const other = pool.integer(1);
    const index = pool.raw({ tag: ConstantTag.Class, nameIndex: other });

    expect(faultFrom(() => classNameAt(pool.build(), index))).toEqual(notA(other, 'Utf8'));
  });
});

describe('resolveMemberReference', () => {
  it('reads the owner, the name and the descriptor of a Methodref', () => {
    const pool = new ConstantPoolBuilder();
    const index = pool.methodref('java/lang/Math', 'abs', '(I)I');

    expect(resolveMethodref(pool.build(), index)).toEqual({
      className: 'java/lang/Math',
      name: 'abs',
      descriptor: '(I)I',
    });
  });

  it('reads a Fieldref the same way', () => {
    const pool = new ConstantPoolBuilder();
    const index = pool.fieldref('java/lang/System', 'out', 'Ljava/io/PrintStream;');

    expect(resolveMemberReference(pool.build(), index, ConstantTag.Fieldref, 'Fieldref')).toEqual({
      className: 'java/lang/System',
      name: 'out',
      descriptor: 'Ljava/io/PrintStream;',
    });
  });

  it('rejects an index that is not a Methodref', () => {
    const pool = new ConstantPoolBuilder();
    const index = pool.utf8('not a method');

    expect(faultFrom(() => resolveMethodref(pool.build(), index))).toEqual(
      notA(index, 'Methodref'),
    );
  });

  it('rejects an empty pool slot', () => {
    expect(faultFrom(() => resolveMethodref(new ConstantPoolBuilder().build(), 0))).toEqual(
      notA(0, 'Methodref'),
    );
  });

  it('holds the two member tags apart', () => {
    const pool = new ConstantPoolBuilder();
    const index = pool.fieldref(SYNTHETIC_CLASS_NAME, 'count', 'I');

    expect(faultFrom(() => resolveMethodref(pool.build(), index))).toEqual(
      notA(index, 'Methodref'),
    );
  });

  it('rejects a Methodref whose class_index is not a Class', () => {
    const pool = new ConstantPoolBuilder();
    const bogus = pool.utf8('bogus');
    const index = pool.raw({
      tag: ConstantTag.Methodref,
      classIndex: bogus,
      nameAndTypeIndex: bogus,
    });

    expect(faultFrom(() => resolveMethodref(pool.build(), index))).toEqual(notA(bogus, 'Class'));
  });

  it('rejects a Methodref whose name_and_type_index is not a NameAndType', () => {
    const pool = new ConstantPoolBuilder();
    const owner = pool.classEntry(SYNTHETIC_CLASS_NAME);
    const bogus = pool.utf8('bogus');
    const index = pool.raw({
      tag: ConstantTag.Methodref,
      classIndex: owner,
      nameAndTypeIndex: bogus,
    });

    expect(faultFrom(() => resolveMethodref(pool.build(), index))).toEqual(
      notA(bogus, 'NameAndType'),
    );
  });

  it('rejects a NameAndType that does not point at Utf8 entries', () => {
    const pool = new ConstantPoolBuilder();
    const owner = pool.classEntry(SYNTHETIC_CLASS_NAME);
    const nameAndType = pool.raw({
      tag: ConstantTag.NameAndType,
      nameIndex: owner,
      descriptorIndex: owner,
    });
    const index = pool.raw({
      tag: ConstantTag.Methodref,
      classIndex: owner,
      nameAndTypeIndex: nameAndType,
    });

    expect(faultFrom(() => resolveMethodref(pool.build(), index))).toEqual(notA(owner, 'Utf8'));
  });
});

describe('callTarget', () => {
  it('names a member the way the JVM writes it', () => {
    expect(callTarget({ className: 'java/lang/Math', name: 'max', descriptor: '(II)I' })).toBe(
      'java/lang/Math.max(II)I',
    );
  });
});

describe('describeConstant', () => {
  it('names the tag of an entry that is there', () => {
    expect(describeConstant({ tag: ConstantTag.Float, value: 1.5 }, 7)).toBe(
      'the Float constant at #7',
    );
  });

  it('falls back to the index alone when nothing is there', () => {
    expect(describeConstant(undefined, 200)).toBe('constant pool entry #200');
  });
});

describe('parameterKinds', () => {
  it.each([
    { descriptor: '()V', kinds: [] },
    { descriptor: '(II)I', kinds: ['int', 'int'] },
    { descriptor: '(BCSZ)Z', kinds: ['int', 'int', 'int', 'int'] },
    { descriptor: '([Ljava/lang/String;)V', kinds: ['ref'] },
    { descriptor: '(Ljava/lang/String;I)Ljava/lang/String;', kinds: ['ref', 'int'] },
    { descriptor: '(I[I)[I', kinds: ['int', 'ref'] },
  ])('maps $descriptor onto the slots a frame needs', ({ descriptor, kinds }) => {
    expect(parameterKinds(descriptor)).toEqual(kinds);
  });

  it.each([
    { case: 'a long parameter', descriptor: '(J)V' },
    { case: 'a double parameter', descriptor: '(D)V' },
    { case: 'a long return type', descriptor: '()J' },
    { case: 'a descriptor without a parameter list', descriptor: 'I' },
    { case: 'an unknown type character', descriptor: '(Q)V' },
    { case: 'an unterminated class name', descriptor: '(Ljava/lang/String)V' },
  ])('refuses $case', ({ descriptor }) => {
    expect(parameterKinds(descriptor)).toBeUndefined();
  });
});

describe('fieldKind', () => {
  it.each(['B', 'C', 'I', 'S', 'Z'])('uses an int slot for %s', (descriptor) => {
    expect(fieldKind(descriptor)).toBe('int');
  });

  it.each(['[I', 'Ljava/lang/String;'])('uses a reference slot for %s', (descriptor) => {
    expect(fieldKind(descriptor)).toBe('ref');
  });

  it.each(['J', 'F', 'D', 'V', '', 'L;'])('refuses unsupported field type %s', (descriptor) => {
    expect(fieldKind(descriptor)).toBeUndefined();
  });
});
