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
  | { readonly kind: 'invalid-state'; readonly message: string };

export class VmFault extends Error {
  readonly detail: VmFaultDetail;

  constructor(detail: VmFaultDetail) {
    super(describeFault(detail));
    this.name = 'VmFault';
    this.detail = detail;
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
      return `Unsupported call: ${detail.target} — only static int methods of the executed class can be called`;
    case 'invalid-state':
      return detail.message;
  }
}
