import { isClassFileError, type ClassFileErrorDetail } from '../errors';

/**
 * Runs `run` and returns the `detail` of the thrown `ClassFileError`.
 *
 * Any other exception (e.g. a `RangeError` from `DataView`) is rethrown so the test fails
 * with the original stack trace — that is exactly the case the parser must never produce.
 */
export function expectClassFileError(run: () => unknown): ClassFileErrorDetail {
  try {
    run();
  } catch (error) {
    if (isClassFileError(error)) {
      return error.detail;
    }
    throw error;
  }

  throw new Error('expected a ClassFileError, but the call completed without throwing');
}
