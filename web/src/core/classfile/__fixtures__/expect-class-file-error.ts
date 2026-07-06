import { isClassFileError, type ClassFileErrorDetail } from '../errors';

/**
 * Uruchamia `run` i zwraca `detail` rzuconego `ClassFileError`.
 *
 * Każdy inny wyjątek (np. `RangeError` z `DataView`) jest przepuszczany dalej, więc test
 * pada z oryginalnym stack trace — to właśnie ten przypadek chcemy w Fazie 1 wykluczyć
 * (plan.md §9 Faza 1: „typowany ClassFileError z offsetem, nie goły RangeError”).
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

  throw new Error('oczekiwano ClassFileError, a wywołanie zakończyło się bez wyjątku');
}
