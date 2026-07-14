/**
 * Every way this application can fail, as one union, plus the mapping from a failure to the
 * sentence shown in the banner.
 *
 * The domain layers already carry their own typed details (`ClassFileErrorDetail`,
 * `VmError`); this module adds the failures that only exist at the application boundary —
 * downloads, uploads, the step limit — and decides the wording and the severity for all of
 * them in one place.
 */

import {
  formatClassFileError,
  isClassFileError,
  type ClassFileErrorDetail,
} from '../core/classfile';
import type { VmError } from '../core/interpreter';

import { formatExampleLoadError, isExampleLoadError, type ExampleLoadDetail } from './examples';

export type AppError =
  | { readonly kind: 'class-file'; readonly detail: ClassFileErrorDetail }
  | { readonly kind: 'vm'; readonly error: VmError }
  | { readonly kind: 'step-limit'; readonly limit: number }
  | {
      readonly kind: 'file-too-large';
      readonly fileName: string;
      readonly bytes: number;
      readonly limit: number;
    }
  | { readonly kind: 'file-unreadable'; readonly fileName: string; readonly reason: string }
  | { readonly kind: 'example-load'; readonly detail: ExampleLoadDetail }
  | { readonly kind: 'unexpected'; readonly reason: string };

/** A stopped run is an error; one that merely ran out of steps is a warning. */
export type ErrorSeverity = 'error' | 'warning';

export interface ErrorPresentation {
  readonly severity: ErrorSeverity;
  readonly message: string;
}

export function describeAppError(error: AppError): ErrorPresentation {
  switch (error.kind) {
    case 'class-file':
      return { severity: 'error', message: formatClassFileError(error.detail) };
    case 'vm':
      return { severity: 'error', message: describeVmError(error.error) };
    case 'step-limit':
      return {
        severity: 'warning',
        message:
          `Stopped after ${error.limit.toLocaleString('en-US')} steps — the program probably ` +
          'does not terminate. Showing the history up to this point.',
      };
    case 'file-too-large':
      return {
        severity: 'error',
        message:
          `"${error.fileName}" is ${formatBytes(error.bytes)} — the upload limit is ` +
          `${formatBytes(error.limit)}. Class files this large are not hand-written Java.`,
      };
    case 'file-unreadable':
      return {
        severity: 'error',
        message: `Could not read "${error.fileName}": ${error.reason}.`,
      };
    case 'example-load':
      return { severity: 'error', message: formatExampleLoadError(error.detail) };
    case 'unexpected':
      return { severity: 'error', message: `Unexpected failure: ${error.reason}.` };
  }
}

/**
 * The location is phrased as `(pc 23, method main)` rather than with the core wording: on
 * screen the same parenthesis already carries the byte offset of a parse error, so both
 * families of message read the same way.
 */
function describeVmError(error: VmError): string {
  const at = `(pc ${String(error.offset)}, method ${error.methodName})`;

  switch (error.kind) {
    case 'unsupported-opcode':
      return `Unsupported instruction: ${error.mnemonic} ${at}. This interpreter runs the int-only subset of the JVM instruction set.`;
    case 'unsupported-call':
      return `Unsupported call: ${error.target} ${at}. Only static int methods of the class being executed can be called.`;
    case 'division-by-zero':
      return `ArithmeticException: / by zero ${at}.`;
    case 'invalid-state':
      return `Invalid bytecode state: ${error.message} ${at}.`;
  }
}

/** Anything thrown on the load path, mapped onto the union. */
export function toAppError(error: unknown): AppError {
  if (isClassFileError(error)) {
    return { kind: 'class-file', detail: error.detail };
  }
  if (isExampleLoadError(error)) {
    return { kind: 'example-load', detail: error.detail };
  }
  return { kind: 'unexpected', reason: error instanceof Error ? error.message : String(error) };
}

function formatBytes(bytes: number): string {
  const kib = bytes / 1024;
  if (kib < 1) {
    return `${String(bytes)} B`;
  }
  return kib < 1024 ? `${round(kib)} KiB` : `${round(kib / 1024)} MiB`;
}

function round(value: number): string {
  return value.toFixed(value < 10 ? 1 : 0);
}
