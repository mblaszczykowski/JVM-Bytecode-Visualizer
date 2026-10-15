import type { FaultLocation, VmError, VmFaultDetail } from './types';

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
    return { className: detail.className, message: detail.label, handle: detail.handle };
  }
  const className = THROWN_AS.get(detail.kind);
  return className === undefined
    ? undefined
    : { className, message: describeFault(detail), handle: undefined };
}

export interface ThrownException {
  readonly className: string;
  readonly message: string;
  readonly handle: number | undefined;
}

const THROWN_AS: ReadonlyMap<VmFaultDetail['kind'], string> = new Map([
  ['division-by-zero', 'java/lang/ArithmeticException'],
  ['array-index-out-of-bounds', 'java/lang/ArrayIndexOutOfBoundsException'],
  ['null-reference', 'java/lang/NullPointerException'],
  ['negative-array-size', 'java/lang/NegativeArraySizeException'],
]);

export function describeFault(detail: VmFaultDetail): string {
  switch (detail.kind) {
    case 'unsupported-opcode':
      return `Unsupported instruction: ${detail.mnemonic}`;
    case 'division-by-zero':
      return 'ArithmeticException: / by zero';
    case 'unsupported-call':
      return `Unsupported call: ${detail.target}`;
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
      return `Unsupported array type: ${detail.typeName}`;
    case 'out-of-memory':
      return (
        `OutOfMemoryError: the ${detail.resource} would hold ${String(detail.requested)} ` +
        `elements, and the limit is ${String(detail.limit)}`
      );
    case 'unsupported-field':
      return `Unsupported field: ${detail.target}`;
    case 'unsupported-constant':
      return `Unsupported constant: ${detail.target}`;
    case 'thrown':
      return detail.label;
  }
}
