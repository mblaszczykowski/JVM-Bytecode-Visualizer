/** Interpreter contract: execution snapshots, VM errors and the execution result. */

import type { Instruction } from '../disassembler/types';

export interface StackFrame {
  readonly methodName: string;
  /** Together with methodName it identifies the method unambiguously (overloads). */
  readonly methodDescriptor: string;
  /** Byte offset of the NEXT instruction of this frame — required to resume after a call returns. */
  readonly pc: number;
  /** [0] = bottom of the stack. */
  readonly operandStack: readonly number[];
  /** Slots 0..maxLocals-1; undefined = uninitialised slot. */
  readonly locals: readonly (number | undefined)[];
  /** Names from the LocalVariableTable (javac -g); undefined when the table is absent. */
  readonly localNames: readonly (string | undefined)[];
}

/**
 * Snapshot[i] is the state BEFORE executing snapshot[i].currentInstruction.
 * The last snapshot is terminal: an empty callStack and no currentInstruction.
 */
export interface Snapshot {
  readonly step: number;
  /** [0] = oldest frame; the call stack depth equals length. */
  readonly callStack: readonly StackFrame[];
  readonly currentInstruction?: Instruction;
  /** From the LineNumberTable: the entry with the largest startPc <= pc. */
  readonly sourceLine?: number;
}

export type VmError =
  | {
      readonly kind: 'unsupported-opcode';
      readonly mnemonic: string;
      readonly offset: number;
      readonly methodName: string;
    }
  | { readonly kind: 'division-by-zero'; readonly offset: number; readonly methodName: string }
  | {
      /** invokestatic outside the current class, or an unsupported descriptor. */
      readonly kind: 'unsupported-call';
      readonly target: string;
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** A state impossible for valid bytecode (e.g. an empty operand stack at iadd). */
      readonly kind: 'invalid-state';
      readonly message: string;
      readonly offset: number;
      readonly methodName: string;
    };

export type ExecutionResult =
  | { readonly kind: 'completed'; readonly snapshots: readonly Snapshot[]; readonly returnValue?: number }
  | { readonly kind: 'vm-error'; readonly snapshots: readonly Snapshot[]; readonly error: VmError }
  | { readonly kind: 'step-limit'; readonly snapshots: readonly Snapshot[]; readonly limit: number };

export interface ExecuteOptions {
  /** Defaults to "main". */
  readonly entryMethod?: string;
  /** Defaults to DEFAULT_MAX_STEPS. */
  readonly maxSteps?: number;
}

export const DEFAULT_MAX_STEPS = 20_000;
