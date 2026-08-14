import { describe, expect, it } from 'vitest';

import { classNameAt, nameAndTypeAt, poolEntry, utf8At } from './pool';
import { ConstantTag, type ConstantPool } from './types';

const pool: ConstantPool = [
  null,
  { tag: ConstantTag.Utf8, value: 'java/lang/Object' },
  { tag: ConstantTag.Class, nameIndex: 1 },
  { tag: ConstantTag.Utf8, value: 'value' },
  { tag: ConstantTag.Utf8, value: 'I' },
  { tag: ConstantTag.NameAndType, nameIndex: 3, descriptorIndex: 4 },
  { tag: ConstantTag.Integer, value: 7 },
  { tag: ConstantTag.Class, nameIndex: 6 },
  { tag: ConstantTag.NameAndType, nameIndex: 3, descriptorIndex: 6 },
  { tag: ConstantTag.NameAndType, nameIndex: 6, descriptorIndex: 4 },
  { tag: ConstantTag.Long, value: 1n },
  null,
  { tag: ConstantTag.NameAndType, nameIndex: 99, descriptorIndex: 4 },
];

describe('poolEntry', () => {
  it('reads the entry a 1-indexed pool holds', () => {
    expect(poolEntry(pool, 1)).toEqual({ tag: ConstantTag.Utf8, value: 'java/lang/Object' });
    expect(poolEntry(pool, 2)).toEqual({ tag: ConstantTag.Class, nameIndex: 1 });
  });

  it('reads nothing at slot 0, which the pool never fills (JVMS §4.4)', () => {
    expect(poolEntry(pool, 0)).toBeUndefined();
  });

  it('reads nothing at the second slot a long takes (JVMS §4.4.5)', () => {
    expect(poolEntry(pool, 10)).toEqual({ tag: ConstantTag.Long, value: 1n });
    expect(poolEntry(pool, 11)).toBeUndefined();
  });

  it('reads nothing outside the pool, in either direction', () => {
    expect(poolEntry(pool, -1)).toBeUndefined();
    expect(poolEntry(pool, pool.length)).toBeUndefined();
    expect(poolEntry(pool, 9_999)).toBeUndefined();
  });
});

describe('utf8At', () => {
  it('reads the string of a Utf8 entry', () => {
    expect(utf8At(pool, 1)).toBe('java/lang/Object');
    expect(utf8At(pool, 4)).toBe('I');
  });

  it('reads nothing when the entry is a different tag', () => {
    expect(utf8At(pool, 2)).toBeUndefined();
    expect(utf8At(pool, 6)).toBeUndefined();
  });

  it('reads nothing when the slot is empty or out of range', () => {
    expect(utf8At(pool, 0)).toBeUndefined();
    expect(utf8At(pool, 11)).toBeUndefined();
    expect(utf8At(pool, 99)).toBeUndefined();
  });
});

describe('classNameAt', () => {
  it('follows Class.name_index to the Utf8 that holds the name', () => {
    expect(classNameAt(pool, 2)).toBe('java/lang/Object');
  });

  it('reads nothing when the entry is not a Class', () => {
    expect(classNameAt(pool, 1)).toBeUndefined();
    expect(classNameAt(pool, 5)).toBeUndefined();
    expect(classNameAt(pool, 0)).toBeUndefined();
  });

  it('reads nothing when Class.name_index does not point at a Utf8', () => {
    expect(classNameAt(pool, 7)).toBeUndefined();
  });
});

describe('nameAndTypeAt', () => {
  it('resolves both halves of a NameAndType', () => {
    expect(nameAndTypeAt(pool, 5)).toEqual({ name: 'value', descriptor: 'I' });
  });

  it('reads nothing when the entry is not a NameAndType', () => {
    expect(nameAndTypeAt(pool, 2)).toBeUndefined();
    expect(nameAndTypeAt(pool, 6)).toBeUndefined();
    expect(nameAndTypeAt(pool, 0)).toBeUndefined();
  });

  it('reads nothing when the name resolves but the descriptor does not', () => {
    expect(nameAndTypeAt(pool, 8)).toBeUndefined();
  });

  it('reads nothing when the descriptor resolves but the name does not', () => {
    expect(nameAndTypeAt(pool, 9)).toBeUndefined();
    expect(nameAndTypeAt(pool, 12)).toBeUndefined();
  });
});
