import type { CodeAttribute, LineNumberEntry, LocalVariableEntry, MethodInfo } from '../classfile';
import { disassemble, type DisassembledCode, type Instruction } from '../disassembler';
import { VmFault } from './errors';

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
  readonly locals: (number | undefined)[];
  /**
   * Bumped by every mutation of this frame. A snapshot reuses the frozen copy it already
   * emitted for an unchanged frame, which is what keeps a deep call stack from being copied
   * once per step.
   */
  version: number;
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

/** Static call arguments land in slots 0..n-1, first argument first (JVMS §2.6.1). */
export function createFrame(method: PreparedMethod, args: readonly number[]): Frame {
  const locals = new Array<number | undefined>(method.code.maxLocals).fill(undefined);
  for (let slot = 0; slot < args.length; slot += 1) {
    locals[slot] = args[slot];
  }
  return { method, pc: 0, operandStack: [], locals, version: 0 };
}

export function setPc(frame: Frame, pc: number): void {
  frame.pc = pc;
  frame.version += 1;
}

export function push(frame: Frame, value: number): void {
  frame.operandStack.push(value);
  frame.version += 1;
}

export function pop(frame: Frame): number {
  const value = frame.operandStack.pop();
  if (value === undefined) {
    throw new VmFault({ kind: 'invalid-state', message: 'operand stack underflow' });
  }
  frame.version += 1;
  return value;
}

export function peek(frame: Frame): number {
  const value = frame.operandStack.at(-1);
  if (value === undefined) {
    throw new VmFault({ kind: 'invalid-state', message: 'operand stack underflow' });
  }
  return value;
}

export function loadLocal(frame: Frame, slot: number): number {
  checkSlot(frame, slot);
  const value = frame.locals[slot];
  if (value === undefined) {
    // Slot 0 of `main` (the `args` reference) ends up here: the MVP has no heap, so the
    // sentinel is simply an empty slot that no supported instruction can read.
    throw new VmFault({
      kind: 'invalid-state',
      message: `read from uninitialised local slot ${String(slot)}`,
    });
  }
  return value;
}

export function storeLocal(frame: Frame, slot: number, value: number): void {
  checkSlot(frame, slot);
  frame.locals[slot] = value;
  frame.version += 1;
}

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
