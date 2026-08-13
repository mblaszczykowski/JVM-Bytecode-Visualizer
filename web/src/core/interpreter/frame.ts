import type {
  CodeAttribute,
  ExceptionTableEntry,
  LineNumberEntry,
  LocalVariableEntry,
  MethodInfo,
} from '../classfile';
import { disassemble, type DisassembledCode, type Instruction } from '../disassembler';
import { VmFault } from './errors';
import type { ValueKind } from './types';

export interface FetchedInstruction {
  readonly instruction: Instruction;
  readonly nextOffset: number;
}

export interface PreparedMethod {
  readonly name: string;
  readonly descriptor: string;
  readonly code: CodeAttribute;
  readonly flow: ReadonlyMap<number, FetchedInstruction>;
  readonly localVariables: readonly LocalVariableEntry[];
  readonly localNamesByPc: Map<number, readonly (string | undefined)[]>;
  readonly lineNumbers: readonly LineNumberEntry[];
}

export interface RunClock {
  step: number;
}

export interface Frame {
  readonly method: PreparedMethod;
  pc: number;
  currentPc: number;
  readonly operandStack: number[];
  readonly operandKinds: ValueKind[];
  readonly operandOrigins: number[];
  readonly locals: (number | undefined)[];
  readonly localKinds: (ValueKind | undefined)[];
  readonly localOrigins: (number | undefined)[];
  readonly clock: RunClock;
  version: number;
}

export interface StackValue {
  readonly value: number;
  readonly kind: ValueKind;
}

export function prepareMethod(method: MethodInfo, code: CodeAttribute): PreparedMethod {
  const disassembled = disassemble(code.code);
  const flow = flowOf(disassembled, code.code.length);
  checkBranchTargets(method.name, disassembled.instructions, flow, code.exceptionTable ?? []);

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

export function createFrame(
  method: PreparedMethod,
  args: readonly StackValue[],
  clock: RunClock,
): Frame {
  const locals = new Array<number | undefined>(method.code.maxLocals).fill(undefined);
  const localKinds = new Array<ValueKind | undefined>(method.code.maxLocals).fill(undefined);
  const localOrigins = new Array<number | undefined>(method.code.maxLocals).fill(undefined);
  for (let slot = 0; slot < args.length; slot += 1) {
    locals[slot] = args[slot]?.value;
    localKinds[slot] = args[slot]?.kind;
    localOrigins[slot] = clock.step;
  }
  return {
    method,
    pc: 0,
    currentPc: 0,
    operandStack: [],
    operandKinds: [],
    operandOrigins: [],
    locals,
    localKinds,
    localOrigins,
    clock,
    version: 0,
  };
}

export function clearOperandStack(frame: Frame): void {
  frame.operandStack.length = 0;
  frame.operandKinds.length = 0;
  frame.operandOrigins.length = 0;
  frame.version += 1;
}

export function setPc(frame: Frame, pc: number): void {
  frame.pc = pc;
  frame.version += 1;
}

export function push(frame: Frame, value: number, kind: ValueKind): void {
  frame.operandStack.push(value);
  frame.operandKinds.push(kind);
  frame.operandOrigins.push(frame.clock.step);
  frame.version += 1;
}

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

export function popAny(frame: Frame): StackValue {
  const value = frame.operandStack.pop();
  const kind = frame.operandKinds.pop();
  frame.operandOrigins.pop();
  if (value === undefined || kind === undefined) {
    throw new VmFault({ kind: 'invalid-state', message: 'operand stack underflow' });
  }
  frame.version += 1;
  return { value, kind };
}

export function popReference(frame: Frame): StackValue {
  const popped = popAny(frame);
  if (popped.kind === 'int') {
    throw new VmFault({
      kind: 'invalid-state',
      message: `expected a reference on the operand stack, found ${KIND_NAMES.int}`,
    });
  }
  return popped;
}

export function loadReference(frame: Frame, slot: number): StackValue {
  const held = readSlot(frame, slot);
  if (held.kind === 'int') {
    throw new VmFault({
      kind: 'invalid-state',
      message: `local slot ${String(slot)} holds ${KIND_NAMES.int}, not a reference`,
    });
  }
  return held;
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
  const held = readSlot(frame, slot);
  if (held.kind !== expected) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `local slot ${String(slot)} holds ${KIND_NAMES[held.kind]}, not ${KIND_NAMES[expected]}`,
    });
  }
  return held.value;
}

function readSlot(frame: Frame, slot: number): StackValue {
  checkSlot(frame, slot);
  const value = frame.locals[slot];
  const kind = frame.localKinds[slot];
  if (value === undefined || kind === undefined) {
    throw new VmFault({
      kind: 'invalid-state',
      message: `read from uninitialised local slot ${String(slot)}`,
    });
  }
  return { value, kind };
}

export function storeLocal(frame: Frame, slot: number, value: number, kind: ValueKind): void {
  checkSlot(frame, slot);
  frame.locals[slot] = value;
  frame.localKinds[slot] = kind;
  frame.localOrigins[slot] = frame.clock.step;
  frame.version += 1;
}

const KIND_NAMES: Readonly<Record<ValueKind, string>> = {
  int: 'an int',
  ref: 'a reference',
  external: 'a standard library object',
};

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
  const { instructions, undecodedFromOffset } = disassembled;
  const endOffset = undecodedFromOffset ?? codeLength;

  const flow = new Map<number, FetchedInstruction>();
  for (const [index, instruction] of instructions.entries()) {
    flow.set(instruction.offset, {
      instruction,
      nextOffset: instructions[index + 1]?.offset ?? endOffset,
    });
  }
  return flow;
}

function checkBranchTargets(
  methodName: string,
  instructions: readonly Instruction[],
  flow: ReadonlyMap<number, FetchedInstruction>,
  exceptionTable: readonly ExceptionTableEntry[],
): void {
  for (const instruction of instructions) {
    const targets =
      instruction.switchTargets?.map((arm) => arm.target) ??
      (instruction.branchTarget === undefined ? [] : [instruction.branchTarget]);
    for (const target of targets) {
      if (!flow.has(target)) {
        throw new VmFault(
          { kind: 'bad-branch-target', mnemonic: instruction.mnemonic, target },
          { offset: instruction.offset, methodName },
        );
      }
    }
  }

  for (const entry of exceptionTable) {
    if (!flow.has(entry.handlerPc)) {
      throw new VmFault(
        { kind: 'bad-branch-target', mnemonic: 'exception handler', target: entry.handlerPc },
        { offset: entry.startPc, methodName },
      );
    }
  }
}
