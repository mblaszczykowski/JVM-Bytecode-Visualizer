/** Interpreter contract: execution snapshots, VM errors and the execution result. */

import type { Instruction } from '../disassembler/types';

/**
 * What a 32-bit slot holds. All three kinds are plain numbers — an `int` is its own value, a
 * `ref` is the handle of the object it points at (its index in `Snapshot.heap`), and an
 * `external` is the index in `Snapshot.externals` of an object the interpreter names but does
 * not model, such as `System.out` or a `String` constant.
 */
export type ValueKind = 'int' | 'ref' | 'external';

/**
 * An object the machine can pass around and print but cannot build: it has a name and, for a
 * `String` constant, contents, and nothing else. Kept out of the heap on purpose — the heap
 * holds objects whose fields the program can read, and these have none.
 */
export interface ExternalValue {
  /** Internal name of what it stands for, e.g. `java/io/PrintStream` (JVMS §4.2.1). */
  readonly className: string;
  /** How it reads on screen and in an error message: `System.out`, `"hello"`. */
  readonly label: string;
  /** The characters it stands for — a `String` constant is the one kind that has any. */
  readonly text?: string;
}

/** The only object this heap knows: a fixed-length array of ints (`newarray T_INT`). */
export interface ArrayObject {
  readonly kind: 'int-array';
  readonly length: number;
  readonly elements: readonly number[];
}

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
  /**
   * Kind of each cell of `operandStack`, aligned by index. Optional so the numeric contract
   * above stays the whole contract for anything that only reads values; `execute()` always
   * fills it.
   */
  readonly operandKinds?: readonly ValueKind[];
  /** Kind of each slot of `locals`, aligned by index; undefined = uninitialised slot. */
  readonly localKinds?: readonly (ValueKind | undefined)[];
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
  /**
   * Objects by handle: a `ref` value `h` points at `heap[h]`. Append-only during a run, so
   * consecutive snapshots share every array they did not change. Always present on a snapshot
   * `execute()` produced; optional for the same reason as the kind arrays above.
   */
  readonly heap?: readonly ArrayObject[];
  /**
   * Every line the program has printed up to and including this snapshot's state, i.e. before
   * `currentInstruction` runs. Cumulative, and shared with the previous snapshot whenever that
   * step printed nothing — which is almost every step — so the history stays cheap.
   */
  readonly consoleOutput?: readonly string[];
  /**
   * Objects named but not modelled, by index: a value of kind `external` is a position in
   * this list. Append-only during a run and shared between snapshots, exactly like `heap`.
   */
  readonly externals?: readonly ExternalValue[];
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
    }
  | {
      /** More nested calls than `maxCallDepth` — what a real JVM answers with StackOverflowError. */
      readonly kind: 'stack-overflow';
      /** The depth limit that was reached. */
      readonly limit: number;
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** A branch whose target is not the first byte of an instruction (JVMS §4.9.1). */
      readonly kind: 'bad-branch-target';
      readonly mnemonic: string;
      /** Absolute target the branch resolved to. */
      readonly target: number;
      /** Offset of the branch instruction itself. */
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** An array access outside [0, length) — ArrayIndexOutOfBoundsException on a real JVM. */
      readonly kind: 'array-index-out-of-bounds';
      readonly index: number;
      readonly length: number;
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** `newarray` with a negative count — NegativeArraySizeException on a real JVM. */
      readonly kind: 'negative-array-size';
      readonly size: number;
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** A reference that points at no object — NullPointerException on a real JVM. */
      readonly kind: 'null-reference';
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** `newarray` with an element type outside the int-only heap, e.g. `long[]`. */
      readonly kind: 'unsupported-array-type';
      readonly typeName: string;
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /**
       * A field access the machine has no object for. It models a fixed list of external
       * members (`System.out`) and no instance state at all, so everything else stops here.
       */
      readonly kind: 'unsupported-field';
      /** The member as javap writes it, e.g. `java/lang/System.in:Ljava/io/InputStream;`. */
      readonly target: string;
      readonly offset: number;
      readonly methodName: string;
    }
  | {
      /** `ldc` of a constant pool entry outside the `int` and `String` values it can push. */
      readonly kind: 'unsupported-constant';
      /** What the entry is, e.g. `a Double constant` or `constant pool entry #9`. */
      readonly target: string;
      readonly offset: number;
      readonly methodName: string;
    };

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
  /** Defaults to "main". */
  readonly entryMethod?: string;
  /** Defaults to DEFAULT_MAX_STEPS; anything below 1 is clamped to 1. */
  readonly maxSteps?: number;
  /** Defaults to DEFAULT_MAX_CALL_DEPTH; anything below 1 is clamped to 1. */
  readonly maxCallDepth?: number;
}

export const DEFAULT_MAX_STEPS = 20_000;

/**
 * Frames a run may stack before it is stopped with `stack-overflow`. Far more than the
 * bundled examples need (the deepest is Fibonacci at a handful of frames) and low enough
 * that runaway recursion stops long before the history exhausts the browser tab.
 */
export const DEFAULT_MAX_CALL_DEPTH = 1_500;
