import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { iadd, idiv, imul, ineg, INT_MAX, INT_MIN, irem, isub } from './int32';

/**
 * Reference semantics: exact arithmetic on BigInt, then truncation to the low 32 bits with
 * sign extension — the definition of `int` in JVMS §2.3.1 and §2.11.3. Every property below
 * compares the implementation against it, so an accidental `a * b` or a missing `| 0` fails.
 */
function toInt32(value: bigint): number {
  const low = BigInt.asIntN(32, value);
  return Number(low);
}

const int32 = fc.integer({ min: INT_MIN, max: INT_MAX });
const nonZeroInt32 = int32.filter((value) => value !== 0);

describe('int32', () => {
  it('iadd wraps like the JVM', () => {
    fc.assert(
      fc.property(int32, int32, (value1, value2) => {
        expect(iadd(value1, value2)).toBe(toInt32(BigInt(value1) + BigInt(value2)));
      }),
    );
  });

  it('isub wraps like the JVM', () => {
    fc.assert(
      fc.property(int32, int32, (value1, value2) => {
        expect(isub(value1, value2)).toBe(toInt32(BigInt(value1) - BigInt(value2)));
      }),
    );
  });

  it('imul keeps the low 32 bits of the exact product', () => {
    fc.assert(
      fc.property(int32, int32, (value1, value2) => {
        expect(imul(value1, value2)).toBe(toInt32(BigInt(value1) * BigInt(value2)));
      }),
    );
  });

  it('idiv truncates toward zero', () => {
    fc.assert(
      fc.property(int32, nonZeroInt32, (dividend, divisor) => {
        expect(idiv(dividend, divisor)).toBe(toInt32(BigInt(dividend) / BigInt(divisor)));
      }),
    );
  });

  it('irem takes the sign of the dividend', () => {
    fc.assert(
      fc.property(int32, nonZeroInt32, (dividend, divisor) => {
        expect(irem(dividend, divisor)).toBe(toInt32(BigInt(dividend) % BigInt(divisor)));
      }),
    );
  });

  it('ineg wraps like the JVM', () => {
    fc.assert(
      fc.property(int32, (value) => {
        expect(ineg(value)).toBe(toInt32(-BigInt(value)));
      }),
    );
  });

  it('idiv and irem never produce a negative zero', () => {
    fc.assert(
      fc.property(int32, nonZeroInt32, (dividend, divisor) => {
        expect(Object.is(idiv(dividend, divisor), -0)).toBe(false);
        expect(Object.is(irem(dividend, divisor), -0)).toBe(false);
      }),
    );
    expect(Object.is(ineg(0), -0)).toBe(false);
  });

  // JVMS §6.5 idiv: the only case where the result of an int division is not representable.
  it('overflows INT_MIN / -1 back to INT_MIN', () => {
    expect(idiv(INT_MIN, -1)).toBe(INT_MIN);
    expect(irem(INT_MIN, -1)).toBe(0);
    expect(ineg(INT_MIN)).toBe(INT_MIN);
  });

  it('wraps around the int range', () => {
    expect(iadd(INT_MAX, 1)).toBe(INT_MIN);
    expect(isub(INT_MIN, 1)).toBe(INT_MAX);
    expect(imul(INT_MAX, 2)).toBe(-2);
    expect(imul(65_536, 65_536)).toBe(0);
    expect(imul(INT_MIN, INT_MIN)).toBe(0);
    // 46341^2 = 2147488281 > INT_MAX: the case a plain `a * b` would get wrong.
    expect(imul(46_341, 46_341)).toBe(-2_147_479_015);
  });

  it('divides and takes remainders like Java', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(idiv(7, -2)).toBe(-3);
    expect(irem(7, 3)).toBe(1);
    expect(irem(-7, 3)).toBe(-1);
    expect(irem(7, -3)).toBe(1);
  });
});
