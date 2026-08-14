import { describe, expect, it } from 'vitest';

import { ConstantTag, constantTagName } from './types';

describe('constantTagName (JVMS §4.4)', () => {
  it('names every tag the pool can hold', () => {
    for (const [name, tag] of Object.entries(ConstantTag)) {
      expect(constantTagName(tag)).toBe(name);
    }
  });

  it('reads the tags javap prints by their JVMS names', () => {
    expect(constantTagName(1)).toBe('Utf8');
    expect(constantTagName(10)).toBe('Methodref');
    expect(constantTagName(18)).toBe('InvokeDynamic');
  });

  it('names nothing for the tag values the specification leaves unassigned', () => {
    expect(constantTagName(0)).toBeUndefined();
    expect(constantTagName(2)).toBeUndefined();
    expect(constantTagName(13)).toBeUndefined();
    expect(constantTagName(21)).toBeUndefined();
  });
});
