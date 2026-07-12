import type { CodeAttribute, LineNumberEntry, MethodInfo } from '../classfile';
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
  /** One entry per local slot; `undefined` where the LocalVariableTable says nothing. */
  readonly localNames: readonly (string | undefined)[];
  readonly lineNumbers: readonly LineNumberEntry[];
}

/**
 * Frame of the JVM stack (JVMS §2.6). Mutable during execution — snapshots take the
 * immutable copies the outside world sees.
 */
export interface Frame {
  readonly method: PreparedMethod;
  /** Offset of the next instruction this frame will execute. */
  pc: number;
  readonly operandStack: number[];
  readonly locals: (number | undefined)[];
}

export function prepareMethod(method: MethodInfo, code: CodeAttribute): PreparedMethod {
  return {
    name: method.name,
    descriptor: method.descriptor,
    code,
    flow: flowOf(disassemble(code.code), code.code.length),
    localNames: localNamesOf(code),
    lineNumbers: code.lineNumberTable ?? [],
  };
}

/** Static call arguments land in slots 0..n-1, first argument first (JVMS §2.6.1). */
export function createFrame(method: PreparedMethod, args: readonly number[]): Frame {
  const locals = new Array<number | undefined>(method.code.maxLocals).fill(undefined);
  for (let slot = 0; slot < args.length; slot += 1) {
    locals[slot] = args[slot];
  }
  return { method, pc: 0, operandStack: [], locals };
}

export function push(frame: Frame, value: number): void {
  frame.operandStack.push(value);
}

export function pop(frame: Frame): number {
  const value = frame.operandStack.pop();
  if (value === undefined) {
    throw new VmFault({ kind: 'invalid-state', message: 'operand stack underflow' });
  }
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

function localNamesOf(code: CodeAttribute): readonly (string | undefined)[] {
  const names = new Array<string | undefined>(code.maxLocals).fill(undefined);
  for (const entry of code.localVariableTable ?? []) {
    // Simplification: javac can reuse one slot for several disjoint scopes, but the first
    // name per slot is the right one for the programs the MVP runs, so the pc ranges of the
    // LocalVariableTable entries are not tracked.
    if (entry.index < names.length && names[entry.index] === undefined) {
      names[entry.index] = entry.name;
    }
  }
  return Object.freeze(names);
}
