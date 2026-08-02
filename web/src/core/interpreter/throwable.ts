/**
 * What this machine can throw, and what a `catch` clause of it catches.
 *
 * There is no object model behind an exception here, for the same reason there is none behind
 * `System.out` (see externals.ts): the machine cannot build one. An exception is an
 * `ExternalValue` — a class name and a label — and that is enough for every operation the
 * subset performs on it. It can be caught, stored in the handler's local slot, and thrown
 * again with `athrow`. It cannot be constructed, and `e.getMessage()` is an unsupported call
 * like any other.
 *
 * That bounds the feature honestly: `try`/`catch` works over the exceptions the *machine*
 * raises, which are precisely the ones a beginner meets — divide by zero, an index off the
 * end of an array, a null reference. `throw new IllegalStateException(...)` still stops at the
 * `new`, because building the object is the objects feature and not this one.
 */

const THROWABLE_CLASS = 'java/lang/Throwable';

/**
 * The superclass of each class this machine names, up to `Throwable`.
 *
 * A real JVM answers "does this handler catch that exception?" by loading both classes and
 * walking the hierarchy. Nothing here loads anything, so the fragment of the hierarchy that
 * the throwable classes actually occupy is written down. It is small because the set of
 * exceptions this machine can raise is small, and it is exact: every chain below is the one
 * in the JDK.
 *
 * A handler for a class outside this table catches nothing — which is correct, because
 * nothing outside it can be thrown either.
 */
const SUPERCLASS: ReadonlyMap<string, string> = new Map([
  ['java/lang/ArithmeticException', 'java/lang/RuntimeException'],
  ['java/lang/ArrayIndexOutOfBoundsException', 'java/lang/IndexOutOfBoundsException'],
  ['java/lang/IndexOutOfBoundsException', 'java/lang/RuntimeException'],
  ['java/lang/NullPointerException', 'java/lang/RuntimeException'],
  ['java/lang/NegativeArraySizeException', 'java/lang/RuntimeException'],
  ['java/lang/RuntimeException', 'java/lang/Exception'],
  ['java/lang/Exception', THROWABLE_CLASS],
]);

/**
 * Whether a handler written as `catch (handlerType e)` catches `thrownClass`.
 *
 * `undefined` is the `catch_type = 0` row, which catches everything — how javac compiles
 * `finally`, and how it compiles `catch (Throwable)`.
 */
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

/** Whether this class is one the machine understands as a throwable at all. */
export function isThrowableClass(className: string): boolean {
  return className === THROWABLE_CLASS || SUPERCLASS.has(className);
}
