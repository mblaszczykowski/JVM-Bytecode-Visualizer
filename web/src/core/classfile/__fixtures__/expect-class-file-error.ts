import { isClassFileError, type ClassFileErrorDetail } from '../errors';

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
