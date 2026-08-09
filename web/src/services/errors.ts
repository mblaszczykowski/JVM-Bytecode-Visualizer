import {
  formatClassFileError,
  isClassFileError,
  type ClassFileErrorDetail,
} from '../core/classfile';
import type { VmError } from '../core/interpreter';

import type { CompileResult, UnavailableReason } from './compile-client';
import { formatExampleLoadError, isExampleLoadError, type ExampleLoadDetail } from './examples';

export type AppError =
  | { readonly kind: 'class-file'; readonly detail: ClassFileErrorDetail }
  | { readonly kind: 'vm'; readonly error: VmError }
  | { readonly kind: 'step-limit'; readonly limit: number }
  | { readonly kind: 'no-entry-point'; readonly className: string }
  | {
      readonly kind: 'file-too-large';
      readonly fileName: string;
      readonly bytes: number;
      readonly limit: number;
    }
  | { readonly kind: 'file-unreadable'; readonly fileName: string; readonly reason: string }
  | { readonly kind: 'example-load'; readonly detail: ExampleLoadDetail }
  | { readonly kind: 'unexpected'; readonly reason: string };

export type ErrorSeverity = 'error' | 'warning' | 'info';

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
          `Stopped after ${error.limit.toLocaleString('en-US')} steps: the program probably ` +
          'does not terminate. Showing the history up to this point.',
      };
    case 'no-entry-point':
      return {
        severity: 'info',
        message:
          `${error.className} has no method this machine can start from: a run needs a ` +
          'static method it can enter with no argument values. Nothing is missing from the ' +
          'file itself; the constant pool, the fields and every method listing are on screen ' +
          'to read.',
      };
    case 'file-too-large':
      return {
        severity: 'error',
        message:
          `"${error.fileName}" is ${formatBytes(error.bytes)}; the upload limit is ` +
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

export type CompileFailure = Extract<CompileResult, { kind: 'rate-limited' | 'unavailable' }>;

export function describeCompileFailure(failure: CompileFailure): ErrorPresentation {
  switch (failure.kind) {
    case 'rate-limited':
      return {
        severity: 'warning',
        message: 'The compiler is busy (rate limit). Try again in a minute.',
      };
    case 'unavailable':
      return { severity: 'error', message: describeUnavailable(failure.reason) };
  }
}

function describeUnavailable(reason: UnavailableReason): string {
  const stillWorks = 'The examples and .class uploads still work.';

  switch (reason.kind) {
    case 'network':
      return `Could not reach the compile service: ${reason.reason}. ${stillWorks}`;
    case 'timeout':
      return `The compile service did not answer within ${String(reason.ms / 1000)} s. ${stillWorks}`;
    case 'http':
      return `The compile service answered ${String(reason.status)}. ${stillWorks}`;
    case 'invalid-response':
      return `The compile service sent an answer this build cannot read: ${reason.reason}.`;
  }
}

function describeVmError(error: VmError): string {
  const at = `(pc ${String(error.offset)}, method ${error.methodName})`;
  const historyStands = 'The history up to this point is still playable.';

  switch (error.kind) {
    case 'unsupported-opcode':
      return `Unsupported instruction: ${error.mnemonic} ${at}. This interpreter implements the int-only subset of the JVM instruction set, and ${error.mnemonic} is outside it. ${historyStands}`;
    case 'unsupported-call':
      return `Unsupported call: ${error.target} ${at}. This interpreter resolves calls inside the class it is executing only, and only to its static int methods. There is no Java library behind it. ${historyStands}`;
    case 'division-by-zero':
      return `ArithmeticException: / by zero ${at}.`;
    case 'invalid-state':
      return `The run could not go on: ${error.message} ${at}. ${historyStands}`;
    case 'stack-overflow':
      return (
        'StackOverflowError: the call stack reached its limit of ' +
        `${error.limit.toLocaleString('en-US')} frames ${at}. ` +
        'Recursion without a reachable base case ends up here.'
      );
    case 'bad-branch-target':
      return `Invalid branch target: ${error.mnemonic} jumps to offset ${String(error.target)}, which is not the start of an instruction ${at}.`;
    case 'array-index-out-of-bounds':
      return (
        `ArrayIndexOutOfBoundsException: index ${String(error.index)} out of bounds for ` +
        `length ${String(error.length)} ${at}. ` +
        (error.length === 0
          ? 'The array is empty, so no index is valid.'
          : `Valid indices run from 0 to ${String(error.length - 1)}.`)
      );
    case 'negative-array-size':
      return `NegativeArraySizeException: ${String(error.size)} ${at}. An array cannot be created with a negative length.`;
    case 'null-reference':
      return `NullPointerException: the reference is null ${at}. There is no array behind it to read, write or measure.`;
    case 'unsupported-array-type':
      return `Unsupported array type: ${error.typeName} ${at}. This interpreter only allocates int arrays.`;
    case 'out-of-memory':
      return (
        `OutOfMemoryError ${at}. ` +
        (error.resource === 'heap'
          ? `The program asked for ${error.requested.toLocaleString('en-US')} array elements at once, and this machine holds at most ${error.limit.toLocaleString('en-US')}.`
          : `Recording the arrays this run writes to would have cost ${error.requested.toLocaleString('en-US')} copied elements, and the budget is ${error.limit.toLocaleString('en-US')}. Every step that writes to an array keeps its own copy, so a large array written in a loop costs far more than the array itself.`) +
        ` ${historyStands}`
      );
    case 'unsupported-field':
      return `Unsupported field: ${error.target} ${at}. This interpreter models a short list of external members (System.out among them) and no instance state at all, so there is no object here to read the field from. ${historyStands}`;
    case 'unsupported-constant':
      return `Unsupported constant: ${error.target} ${at}. ldc pushes the int and String entries of the constant pool here; the other constant kinds have no value this machine can hold. ${historyStands}`;
    case 'uncaught-exception':
      return (
        `${error.label} ${at}. Nothing on the call stack caught it, so every frame was ` +
        `unwound and the run ended, exactly as a real JVM would end it. Scrub back to watch ` +
        `the stack unwind. ${historyStands}`
      );
  }
}

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
