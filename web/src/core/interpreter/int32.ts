/**
 * `int` arithmetic with JVM semantics (JVMS §2.11.3, §6.5).
 *
 * A JavaScript number is a double, so every result has to be forced back into 32 bits:
 * `| 0` after add/sub/neg, `Math.imul` for multiplication — a plain `a * b` returns the
 * exact product (up to 2^53) instead of the wrapped low 32 bits.
 *
 * `| 0` also normalises `-0`, which JS produces for `-4 % 2` and `0 / -5`; the JVM has no
 * negative zero for `int`, and `Object.is(-0, 0)` is false, so leaking it would poison
 * comparisons downstream.
 */

export const INT_MIN = -2_147_483_648;
export const INT_MAX = 2_147_483_647;

export function iadd(value1: number, value2: number): number {
  return (value1 + value2) | 0;
}

export function isub(value1: number, value2: number): number {
  return (value1 - value2) | 0;
}

export function imul(value1: number, value2: number): number {
  return Math.imul(value1, value2);
}

/**
 * Division truncated toward zero. The divisor must be non-zero — the interpreter reports
 * the VM error before calling (the JVM throws ArithmeticException).
 *
 * JVMS §6.5 idiv: `INT_MIN / -1` overflows and the result is defined to be `INT_MIN`,
 * which is exactly what wrapping the double quotient back into 32 bits gives.
 */
export function idiv(dividend: number, divisor: number): number {
  return (dividend / divisor) | 0;
}

/** JVMS §6.5 irem: the result takes the sign of the dividend, as `%` does in JS. */
export function irem(dividend: number, divisor: number): number {
  return (dividend % divisor) | 0;
}

export function ineg(value: number): number {
  return -value | 0;
}

/**
 * JVMS §6.5 ishl/ishr/iushr: only the low five bits of value2 are the shift distance, so
 * `1 << 32` is `1` and not `0`. JavaScript's shift operators mask the same way, but the mask
 * is written out rather than relied on — it is the rule the JVM states, and `iushr` needs the
 * masked distance anyway to keep `>>>` from being applied to an unmasked value.
 */
const SHIFT_MASK = 0x1f;

export function ishl(value1: number, value2: number): number {
  return value1 << (value2 & SHIFT_MASK);
}

/** Arithmetic shift: the sign bit is replicated, so `-8 >> 1` is `-4`. */
export function ishr(value1: number, value2: number): number {
  return value1 >> (value2 & SHIFT_MASK);
}

/**
 * Logical shift: zeros come in from the left. `>>>` yields an unsigned 32-bit value, i.e. a
 * double above 2^31 for a negative input, so the result is wrapped back into a signed int.
 */
export function iushr(value1: number, value2: number): number {
  return (value1 >>> (value2 & SHIFT_MASK)) | 0;
}

export function iand(value1: number, value2: number): number {
  return value1 & value2;
}

export function ior(value1: number, value2: number): number {
  return value1 | value2;
}

export function ixor(value1: number, value2: number): number {
  return value1 ^ value2;
}

/** JVMS §6.5 i2b: truncate to a signed byte, then sign-extend back to an int. */
export function i2b(value: number): number {
  return (value << 24) >> 24;
}

/** JVMS §6.5 i2c: `char` is the one unsigned type — the result is always in [0, 65535]. */
export function i2c(value: number): number {
  return value & 0xffff;
}

/** JVMS §6.5 i2s: truncate to a signed short, then sign-extend back to an int. */
export function i2s(value: number): number {
  return (value << 16) >> 16;
}

/**
 * `Math.abs(int)` to the letter of its javadoc: the absolute value of `Integer.MIN_VALUE` is
 * not representable as an int, and the specified answer is `Integer.MIN_VALUE` itself, which
 * is what wrapping the negation back into 32 bits gives.
 */
export function iabs(value: number): number {
  return value < 0 ? ineg(value) : value;
}

/**
 * `Math.floorDiv(int, int)`: division rounded towards negative infinity rather than towards
 * zero, so it differs from `idiv` exactly when the operands have opposite signs and the
 * division is not exact. `floorDiv(INT_MIN, -1)` overflows to `INT_MIN`, like `idiv`.
 */
export function ifloorDiv(dividend: number, divisor: number): number {
  const quotient = idiv(dividend, divisor);
  return (dividend ^ divisor) < 0 && imul(quotient, divisor) !== dividend
    ? isub(quotient, 1)
    : quotient;
}

/** `Math.floorMod(int, int)`: the remainder that goes with `ifloorDiv`, so it takes the sign of the divisor. */
export function ifloorMod(dividend: number, divisor: number): number {
  return isub(dividend, imul(ifloorDiv(dividend, divisor), divisor));
}
