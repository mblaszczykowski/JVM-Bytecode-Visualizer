/**
 * Kontrakt interpretera — plan.md §5.3–5.4. Zmiana kontraktu wymaga aktualizacji
 * plan.md i ADR-a w tym samym commicie.
 */

import type { Instruction } from '../disassembler/types';

export interface StackFrame {
  readonly methodName: string;
  /** Razem z methodName jednoznacznie identyfikuje metodę (przeciążenia). */
  readonly methodDescriptor: string;
  /** Offset bajtowy NASTĘPNEJ instrukcji tej ramki — konieczny do wznowienia po powrocie z wywołania. */
  readonly pc: number;
  /** [0] = dno stosu. */
  readonly operandStack: readonly number[];
  /** Sloty 0..maxLocals-1; undefined = slot niezainicjalizowany. */
  readonly locals: readonly (number | undefined)[];
  /** Nazwy z LocalVariableTable (javac -g); undefined, gdy tabela niedostępna. */
  readonly localNames: readonly (string | undefined)[];
}

/**
 * Snapshot[i] to stan PRZED wykonaniem snapshot[i].currentInstruction.
 * Ostatni snapshot jest terminalny: pusty callStack, bez currentInstruction.
 */
export interface Snapshot {
  readonly step: number;
  /** [0] = najstarsza ramka; głębokość stosu wywołań = length. */
  readonly callStack: readonly StackFrame[];
  readonly currentInstruction?: Instruction;
  /** Z LineNumberTable: wpis o największym startPc <= pc (plan.md §8 pkt 11). */
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
      /** invokestatic poza bieżącą klasę albo nieobsługiwany deskryptor (plan.md §6, §8 pkt 6). */
      readonly kind: 'unsupported-call';
      readonly target: string;
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** Stan niemożliwy przy poprawnym bajtkodzie (np. pusty stos operandów przy iadd). */
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
  /** Domyślnie "main" (konwencja startu — plan.md §5.4). */
  readonly entryMethod?: string;
  /** Domyślnie DEFAULT_MAX_STEPS (plan.md §8 pkt 9). */
  readonly maxSteps?: number;
}

export const DEFAULT_MAX_STEPS = 20_000;
