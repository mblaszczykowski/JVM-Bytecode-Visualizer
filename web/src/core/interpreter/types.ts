import type { Instruction } from '../disassembler';

export const NO_SNAPSHOTS: readonly Snapshot[] = Object.freeze([]);

export type ValueKind = 'int' | 'ref' | 'external';

export interface ExternalValue {
  readonly className: string;
  readonly label: string;
  readonly text?: string;
  readonly detail?: string;
}

export interface ArrayObject {
  readonly kind: 'int-array';
  readonly length: number;
  readonly elements: readonly number[];
}

export interface FieldSlot {
  readonly name: string;
  readonly descriptor: string;
  readonly value: number;
  readonly kind: ValueKind;
}

export interface InstanceObject {
  readonly kind: 'instance';
  readonly className: string;
  readonly fields: readonly FieldSlot[];
}

export type HeapObject = ArrayObject | InstanceObject;

export interface StackFrame {
  readonly methodName: string;
  readonly methodDescriptor: string;
  readonly pc: number;
  readonly operandStack: readonly number[];
  readonly locals: readonly (number | undefined)[];
  readonly localNames: readonly (string | undefined)[];
  readonly operandKinds?: readonly ValueKind[];
  readonly localKinds?: readonly (ValueKind | undefined)[];
  readonly operandOrigins?: readonly number[];
  readonly localOrigins?: readonly (number | undefined)[];
}

export interface Snapshot {
  readonly step: number;
  readonly callStack: readonly StackFrame[];
  readonly currentInstruction?: Instruction;
  readonly sourceLine?: number;
  readonly heap?: readonly HeapObject[];
  readonly consoleOutput?: readonly string[];
  readonly externals?: readonly ExternalValue[];
}

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

export interface UncaughtException {
  readonly kind: 'uncaught-exception';
  readonly className: string;
  readonly label: string;
}

type Located<T> = T extends unknown ? T & FaultLocation : never;

export type VmError = Located<
  Exclude<VmFaultDetail, { readonly kind: 'thrown' }> | UncaughtException
>;

export type ExecutionResult =
  | {
      readonly kind: 'completed';
      readonly snapshots: readonly Snapshot[];
      readonly returnValue?: number;
    }
  | { readonly kind: 'vm-error'; readonly snapshots: readonly Snapshot[]; readonly error: VmError }
  | {
      readonly kind: 'step-limit';
      readonly snapshots: readonly Snapshot[];
      readonly limit: number;
    };

export interface ExecuteOptions {
  readonly entryMethod?: string;
  readonly entryDescriptor?: string | undefined;
  readonly maxSteps?: number;
  readonly maxCallDepth?: number;
}

export const DEFAULT_MAX_STEPS = 20_000;

export const DEFAULT_MAX_CALL_DEPTH = 1_500;
