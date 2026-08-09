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

export function idiv(dividend: number, divisor: number): number {
  return (dividend / divisor) | 0;
}

export function irem(dividend: number, divisor: number): number {
  return (dividend % divisor) | 0;
}

export function ineg(value: number): number {
  return -value | 0;
}

const SHIFT_MASK = 0x1f;

export function ishl(value1: number, value2: number): number {
  return value1 << (value2 & SHIFT_MASK);
}

export function ishr(value1: number, value2: number): number {
  return value1 >> (value2 & SHIFT_MASK);
}

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

export function i2b(value: number): number {
  return (value << 24) >> 24;
}

export function i2c(value: number): number {
  return value & 0xffff;
}

export function i2s(value: number): number {
  return (value << 16) >> 16;
}

export function iabs(value: number): number {
  return value < 0 ? ineg(value) : value;
}

export function ifloorDiv(dividend: number, divisor: number): number {
  const quotient = idiv(dividend, divisor);
  return (dividend ^ divisor) < 0 && imul(quotient, divisor) !== dividend
    ? isub(quotient, 1)
    : quotient;
}

export function ifloorMod(dividend: number, divisor: number): number {
  return isub(dividend, imul(ifloorDiv(dividend, divisor), divisor));
}
