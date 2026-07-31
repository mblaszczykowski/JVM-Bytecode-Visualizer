import type { VmError } from './types';

/**
 * A fault raised while executing a single instruction.
 *
 * The variants mirror `VmError` minus the location: an instruction handler knows *what*
 * went wrong, the run loop knows *where* (offset and method) and assembles the final error.
 * `VmFault` never escapes the interpreter — `execute()` turns it into an `ExecutionResult`.
 */
export type VmFaultDetail =
  | { readonly kind: 'unsupported-opcode'; readonly mnemonic: string }
  | { readonly kind: 'division-by-zero' }
  | { readonly kind: 'unsupported-call'; readonly target: string }
  | { readonly kind: 'invalid-state'; readonly message: string }
  | { readonly kind: 'stack-overflow'; readonly limit: number }
  | { readonly kind: 'bad-branch-target'; readonly mnemonic: string; readonly target: number }
  | { readonly kind: 'array-index-out-of-bounds'; readonly index: number; readonly length: number }
  | { readonly kind: 'negative-array-size'; readonly size: number }
  | { readonly kind: 'null-reference' }
  | { readonly kind: 'unsupported-array-type'; readonly typeName: string }
  | { readonly kind: 'unsupported-field'; readonly target: string }
  | { readonly kind: 'unsupported-constant'; readonly target: string };

/** Where a fault happened, when that is not the instruction currently being executed. */
export interface FaultLocation {
  readonly offset: number;
  readonly methodName: string;
}

export class VmFault extends Error {
  readonly detail: VmFaultDetail;
  /**
   * Set for faults found outside the run loop — preparing a method reports the offset of the
   * offending instruction of *that* method, which is not where the pc stands.
   */
  readonly location: FaultLocation | undefined;

  constructor(detail: VmFaultDetail, location?: FaultLocation) {
    super(describeFault(detail));
    this.name = 'VmFault';
    this.detail = detail;
    this.location = location;
  }
}

export function isVmFault(error: unknown): error is VmFault {
  return error instanceof VmFault;
}

export function toVmError(detail: VmFaultDetail, offset: number, methodName: string): VmError {
  return { ...detail, offset, methodName };
}

/** Message ready to be shown to the user. */
export function formatVmError(error: VmError): string {
  return `${describeFault(error)} — offset ${String(error.offset)} in ${error.methodName}().`;
}

function describeFault(detail: VmFaultDetail): string {
  switch (detail.kind) {
    case 'unsupported-opcode':
      return `Unsupported instruction: ${detail.mnemonic}`;
    case 'division-by-zero':
      // Wording taken from the exception a real JVM throws here (java.lang.ArithmeticException).
      return 'ArithmeticException: / by zero';
    case 'unsupported-call':
      return `Unsupported call: ${detail.target} — the executed class's own static int methods and a small set of java.lang.Math and System.out members are all this interpreter can call`;
    case 'invalid-state':
      return detail.message;
    case 'stack-overflow':
      // Wording taken from the error a real JVM throws here (java.lang.StackOverflowError).
      return `StackOverflowError: the call stack reached its limit of ${String(detail.limit)} frames`;
    case 'bad-branch-target':
      return `Invalid branch target: ${detail.mnemonic} jumps to offset ${String(detail.target)}, which is not the start of an instruction`;
    case 'array-index-out-of-bounds':
      // Wording taken from java.lang.ArrayIndexOutOfBoundsException, verbatim.
      return `ArrayIndexOutOfBoundsException: index ${String(detail.index)} out of bounds for length ${String(detail.length)}`;
    case 'negative-array-size':
      // java.lang.NegativeArraySizeException carries the size and nothing else.
      return `NegativeArraySizeException: ${String(detail.size)}`;
    case 'null-reference':
      return 'NullPointerException: the reference is null';
    case 'unsupported-array-type':
      return `Unsupported array type: ${detail.typeName} — only int arrays can be allocated`;
    case 'unsupported-field':
      return `Unsupported field: ${detail.target} — this interpreter has no objects to hold fields, and java/lang/System.out is the only one it recognises`;
    case 'unsupported-constant':
      return `Unsupported constant: ${detail.target} — ldc can push an int or a String constant, and nothing else`;
  }
}
