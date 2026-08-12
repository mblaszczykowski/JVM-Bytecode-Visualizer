import { describe, expect, it } from 'vitest';

import {
  accessFlagNames,
  AccessFlag,
  CLASS_ACCESS_FLAGS,
  FIELD_ACCESS_FLAGS,
  isStatic,
  METHOD_ACCESS_FLAGS,
} from './types';

describe('access flags (JVMS §4.1, §4.5, §4.6)', () => {
  it('names the class flags javap prints for a public final class', () => {
    expect(accessFlagNames(0x0031, CLASS_ACCESS_FLAGS)).toEqual(['public', 'final', 'super']);
  });

  it('names the flags of a compiler-generated enum class', () => {
    expect(accessFlagNames(0x4030, CLASS_ACCESS_FLAGS)).toEqual(['final', 'super', 'enum']);
  });

  it('names the method flags, including the ones javac adds by itself', () => {
    expect(accessFlagNames(0x1109, METHOD_ACCESS_FLAGS)).toEqual([
      'public',
      'static',
      'native',
      'synthetic',
    ]);
    expect(accessFlagNames(0x00c1, METHOD_ACCESS_FLAGS)).toEqual(['public', 'bridge', 'varargs']);
  });

  it('reads the same bit as volatile on a field and as bridge on a method', () => {
    expect(accessFlagNames(0x0040, FIELD_ACCESS_FLAGS)).toEqual(['volatile']);
    expect(accessFlagNames(0x0040, METHOD_ACCESS_FLAGS)).toEqual(['bridge']);
  });

  it('names nothing for a member with no flags set', () => {
    expect(accessFlagNames(0, FIELD_ACCESS_FLAGS)).toEqual([]);
  });

  it('answers isStatic from the same bit the tables use', () => {
    expect(isStatic(AccessFlag.Static | AccessFlag.Public)).toBe(true);
    expect(isStatic(AccessFlag.Public)).toBe(false);
    expect(accessFlagNames(AccessFlag.Static, METHOD_ACCESS_FLAGS)).toEqual(['static']);
  });
});
