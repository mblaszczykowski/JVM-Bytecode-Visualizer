const THROWABLE_CLASS = 'java/lang/Throwable';

const SUPERCLASS: ReadonlyMap<string, string> = new Map([
  ['java/lang/ArithmeticException', 'java/lang/RuntimeException'],
  ['java/lang/ArrayIndexOutOfBoundsException', 'java/lang/IndexOutOfBoundsException'],
  ['java/lang/IndexOutOfBoundsException', 'java/lang/RuntimeException'],
  ['java/lang/NullPointerException', 'java/lang/RuntimeException'],
  ['java/lang/NegativeArraySizeException', 'java/lang/RuntimeException'],
  ['java/lang/RuntimeException', 'java/lang/Exception'],
  ['java/lang/Exception', THROWABLE_CLASS],
]);

export function catches(handlerType: string | undefined, thrownClass: string): boolean {
  if (handlerType === undefined) {
    return true;
  }
  let current: string | undefined = thrownClass;
  while (current !== undefined) {
    if (current === handlerType) {
      return true;
    }
    current = SUPERCLASS.get(current);
  }
  return false;
}

export function isThrowableClass(className: string): boolean {
  return className === THROWABLE_CLASS || SUPERCLASS.has(className);
}
