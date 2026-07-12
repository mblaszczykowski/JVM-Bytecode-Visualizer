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
