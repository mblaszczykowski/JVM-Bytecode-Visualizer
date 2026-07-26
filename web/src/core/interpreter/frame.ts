import type { CodeAttribute, LineNumberEntry, LocalVariableEntry, MethodInfo } from '../classfile';
import { disassemble, type DisassembledCode, type Instruction } from '../disassembler';
import { VmFault } from './errors';
import type { ValueKind } from './types';

export interface FetchedInstruction {
  readonly instruction: Instruction;
  /** Offset of the following instruction — where the pc goes unless a branch moves it. */
  readonly nextOffset: number;
}

/**
 * A method ready to execute: disassembled once per run and cached, because the interpreter
 * revisits the same method on every loop iteration and every recursive call.
 */
export interface PreparedMethod {
  readonly name: string;
  readonly descriptor: string;
  readonly code: CodeAttribute;
  /** Instruction fetch by pc; a missing offset means undecodable bytes or past-the-end. */
  readonly flow: ReadonlyMap<number, FetchedInstruction>;
  /** LocalVariableTable entries, kept with their pc ranges — a slot can name several variables. */
  readonly localVariables: readonly LocalVariableEntry[];
  /** Memo of `localNamesAt`: one frozen array per pc the run actually visits. */
  readonly localNamesByPc: Map<number, readonly (string | undefined)[]>;
  readonly lineNumbers: readonly LineNumberEntry[];
}

/**
 * Frame of the JVM stack (JVMS §2.6). Mutable during execution — snapshots take the
 * immutable copies the outside world sees.
 */
export interface Frame {
  readonly method: PreparedMethod;
  /** Offset of the next instruction this frame will execute; written through `setPc`. */
  pc: number;
  readonly operandStack: number[];
  /** Kind of each cell of `operandStack`, pushed and popped with it. */
  readonly operandKinds: ValueKind[];
  readonly locals: (number | undefined)[];
  /** Kind of each slot of `locals`; `undefined` exactly where the slot is uninitialised. */
  readonly localKinds: (ValueKind | undefined)[];
  /**
   * Bumped by every mutation of this frame. A snapshot reuses the frozen copy it already
   * emitted for an unchanged frame, which is what keeps a deep call stack from being copied
   * once per step.
   */
  version: number;
}

/** One cell of the operand stack, for the instructions that move values without typing them. */
export interface StackValue {
  readonly value: number;
  readonly kind: ValueKind;
}

export function prepareMethod(method: MethodInfo, code: CodeAttribute): PreparedMethod {
  const disassembled = disassemble(code.code);
  const flow = flowOf(disassembled, code.code.length);
  checkBranchTargets(method.name, disassembled.instructions, flow);

  return {
    name: method.name,
    descriptor: method.descriptor,
    code,
    flow,
    localVariables: code.localVariableTable ?? [],
    localNamesByPc: new Map(),
    lineNumbers: code.lineNumberTable ?? [],
  };
}

/**
 * Static call arguments land in slots 0..n-1, first argument first (JVMS §2.6.1). Only int
 * parameters are callable, so every argument slot starts out holding an int.
 */
export function createFrame(method: PreparedMethod, args: readonly number[]): Frame {
  const locals = new Array<number | undefined>(method.code.maxLocals).fill(undefined);
  const localKinds = new Array<ValueKind | undefined>(method.code.maxLocals).fill(undefined);
  for (let slot = 0; slot < args.length; slot += 1) {
    locals[slot] = args[slot];
    localKinds[slot] = 'int';
  }
  return { method, pc: 0, operandStack: [], operandKinds: [], locals, localKinds, version: 0 };
}

export function setPc(frame: Frame, pc: number): void {
  frame.pc = pc;
  frame.version += 1;
}

export function push(frame: Frame, value: number, kind: ValueKind): void {
  frame.operandStack.push(value);
  frame.operandKinds.push(kind);
  frame.version += 1;
}

/**
 * Pops a value the instruction expects to be of `expected` kind. Reading a reference as an
 * int (or the reverse) is a state the JVM verifier rejects before the code ever runs
 * (JVMS §4.10), so it stops the run here rather than producing a plausible wrong number.
 */
export function pop(frame: Frame, expected: ValueKind): number {
  const popped = popAny(frame);
  if (popped.kind !== expected) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `expected ${KIND_NAMES[expected]} on the operand stack, found ${KIND_NAMES[popped.kind]}`,
    });
  }
  return popped.value;
}

/** Pops whatever is on top — `pop` and `dup` move a value without caring what it is. */
export function popAny(frame: Frame): StackValue {
  const value = frame.operandStack.pop();
  const kind = frame.operandKinds.pop();
  if (value === undefined || kind === undefined) {
    throw new VmFault({ kind: 'invalid-state', message: 'operand stack underflow' });
  }
  frame.version += 1;
  return { value, kind };
}

export function peekAny(frame: Frame): StackValue {
  const value = frame.operandStack.at(-1);
  const kind = frame.operandKinds.at(-1);
  if (value === undefined || kind === undefined) {
    throw new VmFault({ kind: 'invalid-state', message: 'operand stack underflow' });
  }
  return { value, kind };
}

export function loadLocal(frame: Frame, slot: number, expected: ValueKind): number {
  checkSlot(frame, slot);
  const value = frame.locals[slot];
  const kind = frame.localKinds[slot];
  if (value === undefined || kind === undefined) {
    // Slot 0 of `main` (the `String[] args` reference) ends up here: nothing in the executable
    // subset can produce that array, so the slot stays empty rather than holding a fake handle.
    throw new VmFault({
      kind: 'invalid-state',
      message: `read from uninitialised local slot ${String(slot)}`,
    });
  }
  if (kind !== expected) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `local slot ${String(slot)} holds ${KIND_NAMES[kind]}, not ${KIND_NAMES[expected]}`,
    });
  }
  return value;
}

export function storeLocal(frame: Frame, slot: number, value: number, kind: ValueKind): void {
  checkSlot(frame, slot);
  frame.locals[slot] = value;
  frame.localKinds[slot] = kind;
  frame.version += 1;
}

const KIND_NAMES: Readonly<Record<ValueKind, string>> = {
  int: 'an int',
  ref: 'a reference',
};

/**
 * Names visible at `pc`, one per slot.
 *
 * JVMS §4.7.13: an entry names its slot only inside [start_pc, start_pc + length). javac
 * reuses one slot for disjoint scopes — two sequential `for (int i …)` loops share a slot —
 * so taking the first entry per slot would label the second loop with the first loop's name.
 * The answer only changes with the pc, so it is memoised per method.
 */
export function localNamesAt(method: PreparedMethod, pc: number): readonly (string | undefined)[] {
  const memoised = method.localNamesByPc.get(pc);
  if (memoised !== undefined) {
    return memoised;
  }

  const names = new Array<string | undefined>(method.code.maxLocals).fill(undefined);
  for (const entry of method.localVariables) {
    const inScope = pc >= entry.startPc && pc < entry.startPc + entry.length;
    if (inScope && entry.index >= 0 && entry.index < names.length) {
      names[entry.index] ??= entry.name;
    }
  }

  const frozen = Object.freeze(names);
  method.localNamesByPc.set(pc, frozen);
  return frozen;
}

function checkSlot(frame: Frame, slot: number): void {
  if (slot < 0 || slot >= frame.locals.length) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `local slot ${String(slot)} outside max_locals = ${String(frame.locals.length)}`,
    });
  }
}

function flowOf(
  disassembled: DisassembledCode,
  codeLength: number,
): ReadonlyMap<number, FetchedInstruction> {
  const { instructions, truncatedAtOffset } = disassembled;
  // Falling off the last decoded instruction must land on the undecodable bytes rather than
  // past the end, so the run can report what actually stopped the disassembler.
  const endOffset = truncatedAtOffset ?? codeLength;

  const flow = new Map<number, FetchedInstruction>();
  for (const [index, instruction] of instructions.entries()) {
    flow.set(instruction.offset, {
      instruction,
      nextOffset: instructions[index + 1]?.offset ?? endOffset,
    });
  }
  return flow;
}

/**
 * JVMS §4.9.1: a branch may only target the first byte of an instruction of the same method.
 * Checked once per method, so a target past the end of `code[]` or in the middle of another
 * instruction's operands is named as such, instead of surfacing later as whatever byte the
 * pc happened to land on.
 */
function checkBranchTargets(
  methodName: string,
  instructions: readonly Instruction[],
  flow: ReadonlyMap<number, FetchedInstruction>,
): void {
  for (const instruction of instructions) {
    const { branchTarget } = instruction;
    if (branchTarget !== undefined && !flow.has(branchTarget)) {
      throw new VmFault(
        { kind: 'bad-branch-target', mnemonic: instruction.mnemonic, target: branchTarget },
        { offset: instruction.offset, methodName },
      );
    }
  }
}
