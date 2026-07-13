import { isClassFileError, type ClassFileErrorDetail } from '../errors';

/**
 * Returns the `detail` of the `ClassFileError` thrown by `run`. Any other exception — a
 * `RangeError` from `DataView`, say — is rethrown with its own stack trace intact, since that
 * is precisely the failure the parser must never produce.
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
