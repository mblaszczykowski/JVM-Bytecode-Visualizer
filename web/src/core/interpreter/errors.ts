import type { VmError } from './types';

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
  | {
      readonly kind: 'out-of-memory';
      readonly resource: 'heap' | 'history';
      readonly requested: number;
      readonly limit: number;
    }
  | { readonly kind: 'unsupported-field'; readonly target: string }
  | { readonly kind: 'unsupported-constant'; readonly target: string }
  | {
      readonly kind: 'thrown';
      readonly handle: number;
      readonly className: string;
      readonly label: string;
    };

export interface FaultLocation {
  readonly offset: number;
  readonly methodName: string;
}

export class VmFault extends Error {
  readonly detail: VmFaultDetail;
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
  if (detail.kind === 'thrown') {
    const { className, label } = detail;
    return { kind: 'uncaught-exception', className, label, offset, methodName };
  }
  return { ...detail, offset, methodName };
}

export function thrownBy(detail: VmFaultDetail): ThrownException | undefined {
  if (detail.kind === 'thrown') {
    return { className: detail.className, label: detail.label, handle: detail.handle };
  }
  const className = THROWN_AS.get(detail.kind);
  return className === undefined
    ? undefined
    : { className, label: describeFault(detail), handle: undefined };
}

export interface ThrownException {
  readonly className: string;
  readonly label: string;
  readonly handle: number | undefined;
}

const THROWN_AS: ReadonlyMap<VmFaultDetail['kind'], string> = new Map([
  ['division-by-zero', 'java/lang/ArithmeticException'],
  ['array-index-out-of-bounds', 'java/lang/ArrayIndexOutOfBoundsException'],
  ['null-reference', 'java/lang/NullPointerException'],
  ['negative-array-size', 'java/lang/NegativeArraySizeException'],
]);

export function formatVmError(error: VmError): string {
  const described = error.kind === 'uncaught-exception' ? error.label : describeFault(error);
  return `${described} (offset ${String(error.offset)} in ${error.methodName}()).`;
}

function describeFault(detail: VmFaultDetail): string {
  switch (detail.kind) {
    case 'unsupported-opcode':
      return `Unsupported instruction: ${detail.mnemonic}`;
    case 'division-by-zero':
      return 'ArithmeticException: / by zero';
    case 'unsupported-call':
      return `Unsupported call: ${detail.target}. This interpreter can call the executed class's own static int methods and a small set of java.lang.Math and System.out members`;
    case 'invalid-state':
      return detail.message;
    case 'stack-overflow':
      return `StackOverflowError: the call stack reached its limit of ${String(detail.limit)} frames`;
    case 'bad-branch-target':
      return `Invalid branch target: ${detail.mnemonic} jumps to offset ${String(detail.target)}, which is not the start of an instruction`;
    case 'array-index-out-of-bounds':
      return `ArrayIndexOutOfBoundsException: index ${String(detail.index)} out of bounds for length ${String(detail.length)}`;
    case 'negative-array-size':
      return `NegativeArraySizeException: ${String(detail.size)}`;
    case 'null-reference':
      return 'NullPointerException: the reference is null';
    case 'unsupported-array-type':
      return `Unsupported array type: ${detail.typeName}; only int arrays can be allocated`;
    case 'out-of-memory':
      return (
        `OutOfMemoryError: the ${detail.resource} would hold ${String(detail.requested)} ` +
        `array elements, and the limit is ${String(detail.limit)}`
      );
    case 'unsupported-field':
      return `Unsupported field: ${detail.target}. This interpreter has no objects to hold fields, and java/lang/System.out is the only one it recognises`;
    case 'unsupported-constant':
      return `Unsupported constant: ${detail.target}. ldc can push an int or a String constant, and nothing else`;
    case 'thrown':
      return detail.label;
  }
}
