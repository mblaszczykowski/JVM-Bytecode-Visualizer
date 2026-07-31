import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  i2b,
  i2c,
  i2s,
  iabs,
  iadd,
  iand,
  idiv,
  ifloorDiv,
  ifloorMod,
  imul,
  ineg,
  INT_MAX,
  INT_MIN,
  ior,
  irem,
  ishl,
  ishr,
  isub,
  iushr,
  ixor,
} from './int32';

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

/**
 * JVMS §6.5 ishl/ishr/iushr: the shift distance is the low five bits of value2 and nothing
 * else, so a distance of 32 shifts by nothing and a negative one shifts by its low bits. The
 * reference below masks explicitly, which is the only way the property can catch an
 * implementation that leaned on JavaScript's shift operators doing it silently.
 */
const SHIFT_DISTANCE = 0x1f;

describe('int32 — shifts and bitwise logic', () => {
  it('ishl shifts left by the low five bits of value2', () => {
    fc.assert(
      fc.property(int32, int32, (value1, value2) => {
        const distance = BigInt(value2 & SHIFT_DISTANCE);
        expect(ishl(value1, value2)).toBe(toInt32(BigInt(value1) << distance));
      }),
    );
  });

  it('ishr keeps the sign bit while shifting right', () => {
    fc.assert(
      fc.property(int32, int32, (value1, value2) => {
        const distance = BigInt(value2 & SHIFT_DISTANCE);
        // A BigInt `>>` is arithmetic, which is precisely what `ishr` is defined to be.
        expect(ishr(value1, value2)).toBe(toInt32(BigInt(value1) >> distance));
      }),
    );
  });

  it('iushr shifts the unsigned value right, filling with zeros', () => {
    fc.assert(
      fc.property(int32, int32, (value1, value2) => {
        const distance = BigInt(value2 & SHIFT_DISTANCE);
        const unsigned = BigInt.asUintN(32, BigInt(value1));
        expect(iushr(value1, value2)).toBe(toInt32(unsigned >> distance));
      }),
    );
  });

  it.each([
    ['iand', iand, (left: bigint, right: bigint) => left & right],
    ['ior', ior, (left: bigint, right: bigint) => left | right],
    ['ixor', ixor, (left: bigint, right: bigint) => left ^ right],
  ])('%s combines the bits of both operands', (_name, apply, reference) => {
    fc.assert(
      fc.property(int32, int32, (value1, value2) => {
        expect(apply(value1, value2)).toBe(toInt32(reference(BigInt(value1), BigInt(value2))));
      }),
    );
  });

  it('ignores everything above the low five bits of the distance', () => {
    // 1 << 32 is 1, not 0: the distance wraps rather than clearing the value.
    expect(ishl(1, 32)).toBe(1);
    expect(ishl(1, 33)).toBe(2);
    expect(ishr(-8, 33)).toBe(-4);
    expect(iushr(-1, 32)).toBe(-1);
    expect(iushr(-1, 1)).toBe(INT_MAX);
    // A negative distance is masked the same way: -1 & 31 is 31.
    expect(ishl(1, -1)).toBe(INT_MIN);
  });
});

describe('int32 — narrowing conversions', () => {
  it('i2b truncates to a signed byte', () => {
    fc.assert(
      fc.property(int32, (value) => {
        expect(i2b(value)).toBe(Number(BigInt.asIntN(8, BigInt(value))));
      }),
    );
  });

  it('i2s truncates to a signed short', () => {
    fc.assert(
      fc.property(int32, (value) => {
        expect(i2s(value)).toBe(Number(BigInt.asIntN(16, BigInt(value))));
      }),
    );
  });

  it('i2c truncates to an unsigned char, the one JVM type with no sign', () => {
    fc.assert(
      fc.property(int32, (value) => {
        const converted = i2c(value);
        expect(converted).toBe(Number(BigInt.asUintN(16, BigInt(value))));
        expect(converted).toBeGreaterThanOrEqual(0);
        expect(converted).toBeLessThanOrEqual(65_535);
      }),
    );
  });

  it('sign-extends what it truncated, except for char', () => {
    expect(i2b(255)).toBe(-1);
    expect(i2b(128)).toBe(-128);
    expect(i2b(127)).toBe(127);
    expect(i2s(65_535)).toBe(-1);
    expect(i2s(32_768)).toBe(-32_768);
    expect(i2c(-1)).toBe(65_535);
    expect(i2c(INT_MIN)).toBe(0);
  });
});

/** Exact floor division on BigInt: `/` truncates towards zero, so a negative result rounds up. */
function floorDiv(dividend: bigint, divisor: bigint): bigint {
  const quotient = dividend / divisor;
  return dividend % divisor !== 0n && dividend < 0n !== divisor < 0n ? quotient - 1n : quotient;
}

describe('int32 — the java.lang.Math primitives', () => {
  it('iabs is the absolute value wherever one exists', () => {
    fc.assert(
      fc.property(int32, (value) => {
        expect(iabs(value)).toBe(toInt32(value < 0 ? -BigInt(value) : BigInt(value)));
      }),
    );
  });

  // The javadoc of Math.abs(int) states this case outright: the true absolute value of
  // Integer.MIN_VALUE is not an int, and the specified result is Integer.MIN_VALUE.
  it('answers Integer.MIN_VALUE for abs(Integer.MIN_VALUE)', () => {
    expect(iabs(INT_MIN)).toBe(INT_MIN);
    expect(iabs(INT_MAX)).toBe(INT_MAX);
    expect(iabs(-1)).toBe(1);
    expect(Object.is(iabs(0), -0)).toBe(false);
  });

  it('ifloorDiv rounds towards negative infinity', () => {
    fc.assert(
      fc.property(int32, nonZeroInt32, (dividend, divisor) => {
        expect(ifloorDiv(dividend, divisor)).toBe(
          toInt32(floorDiv(BigInt(dividend), BigInt(divisor))),
        );
      }),
    );
  });

  it('ifloorMod takes the sign of the divisor', () => {
    fc.assert(
      fc.property(int32, nonZeroInt32, (dividend, divisor) => {
        const quotient = floorDiv(BigInt(dividend), BigInt(divisor));
        expect(ifloorMod(dividend, divisor)).toBe(
          toInt32(BigInt(dividend) - quotient * BigInt(divisor)),
        );
      }),
    );
  });

  it('differs from idiv exactly where Java says it does', () => {
    expect(ifloorDiv(7, 2)).toBe(3);
    expect(ifloorDiv(-7, 2)).toBe(-4); // idiv would answer -3
    expect(ifloorDiv(7, -2)).toBe(-4);
    expect(ifloorMod(-7, 2)).toBe(1); // irem would answer -1
    expect(ifloorMod(7, -2)).toBe(-1);
    // The same overflow as idiv, and stated the same way in the javadoc.
    expect(ifloorDiv(INT_MIN, -1)).toBe(INT_MIN);
    expect(ifloorMod(INT_MIN, -1)).toBe(0);
  });
});
