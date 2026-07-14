/**
 * What the panels show beyond the raw `Snapshot`: the stack effect of the next instruction,
 * a sentence about the concrete values it will touch, the constant pool resolution chain and
 * the role of each operand stack cell.
 *
 * All of it is derived from the opcode table and the real constant pool — nothing is written
 * out per instruction, so an example the interpreter can run is an example this can explain.
 */

import {
  ConstantTag,
  isClassFileError,
  parseMethodDescriptor,
  type ClassFile,
  type ConstantPool,
} from '../core/classfile';
import { lookupOpcode, type Instruction } from '../core/disassembler';
import type { Snapshot, StackFrame } from '../core/interpreter';

import type { MethodListing } from './program';

export interface EffectPill {
  readonly label: string;
}

export interface NextInstructionSummary {
  readonly effects: readonly EffectPill[];
  readonly explanation: string;
  /** Only for instructions with a constant pool operand. */
  readonly cpChain?: readonly string[] | undefined;
}

export function describeNextInstruction(
  snapshot: Snapshot,
  classFile: ClassFile,
): NextInstructionSummary | undefined {
  const frame = snapshot.callStack.at(-1);
  const instruction = snapshot.currentInstruction;
  if (frame === undefined || instruction === undefined) {
    return undefined;
  }

  const pool = classFile.constantPool;
  const constant = resolveOperandConstant(instruction, pool);

  return {
    effects: effectsOf(instruction, pool),
    explanation: explain(instruction, frame, pool),
    cpChain: constant?.chain,
  };
}

/**
 * Role annotation per operand stack cell (indexed like `StackFrame.operandStack`): what the
 * current instruction is about to do with it, or which later instruction is waiting for it.
 */
export function describeOperandRoles(
  snapshot: Snapshot,
  listing: MethodListing | undefined,
  classFile: ClassFile,
): readonly (string | undefined)[] {
  const frame = snapshot.callStack.at(-1);
  const instruction = snapshot.currentInstruction;
  if (frame === undefined || instruction === undefined) {
    return [];
  }

  const pool = classFile.constantPool;
  const roles: (string | undefined)[] = frame.operandStack.map(() => undefined);
  const topIndex = frame.operandStack.length - 1;
  const effect = stackDeltaOf(instruction, pool) ?? { pops: 0, pushes: 0 };
  const isCall = instruction.mnemonic === 'invokestatic';

  for (let taken = 0; taken < effect.pops && topIndex - taken >= 0; taken++) {
    roles[topIndex - taken] = isCall ? `→ arg ${String(effect.pops - 1 - taken)}` : '→ operand';
  }

  const survivor = topIndex - effect.pops;
  if (survivor >= 0 && listing !== undefined) {
    const consumer = consumerOf(
      listing,
      pool,
      instruction.offset,
      frame.operandStack.length,
      survivor,
    );
    if (consumer !== undefined) {
      roles[survivor] = `waiting for ${consumer}`;
    }
  }

  return roles;
}

/** javap-style trailing comments, keyed by instruction offset. */
export function constantPoolComments(
  listing: MethodListing,
  classFile: ClassFile,
): ReadonlyMap<number, string> {
  const comments = new Map<number, string>();
  for (const instruction of listing.instructions) {
    const constant = resolveOperandConstant(instruction, classFile.constantPool);
    if (constant !== undefined) {
      comments.set(instruction.offset, constant.comment);
    }
  }
  return comments;
}

export interface ResolvedConstant {
  readonly index: number;
  /** Constant pool tag name, e.g. `Methodref`. */
  readonly tagName: string;
  /** Fully resolved text, e.g. `Factorial.factorial:(I)I`. */
  readonly text: string;
  /** Rendered as `#7 → Methodref → Factorial.factorial:(I)I`. */
  readonly chain: readonly string[];
  readonly comment: string;
}

/**
 * Follows a constant pool entry down to the Utf8 strings behind it (JVMS §4.4). Returns
 * `undefined` for an index that does not resolve — a broken pool is a display problem here,
 * not a reason to fail.
 */
export function resolveConstant(pool: ConstantPool, index: number): ResolvedConstant | undefined {
  const entry = pool[index] ?? undefined;
  if (entry === undefined) {
    return undefined;
  }

  const tagName = TAG_NAMES.get(entry.tag) ?? `tag ${String(entry.tag)}`;
  const link = (text: string, comment: string): ResolvedConstant => ({
    index,
    tagName,
    text,
    chain: [`#${String(index)}`, tagName, text],
    comment,
  });

  switch (entry.tag) {
    case ConstantTag.Methodref:
    case ConstantTag.Fieldref: {
      const owner = className(pool, entry.classIndex);
      const member = nameAndType(pool, entry.nameAndTypeIndex);
      if (owner === undefined || member === undefined) {
        return undefined;
      }
      const text = `${owner}.${member.name}:${member.descriptor}`;
      const kind = entry.tag === ConstantTag.Methodref ? 'Method' : 'Field';
      return link(text, `// ${kind} ${text}`);
    }
    case ConstantTag.Class: {
      const name = utf8(pool, entry.nameIndex);
      return name === undefined ? undefined : link(name, `// class ${name}`);
    }
    case ConstantTag.NameAndType: {
      const member = nameAndType(pool, index);
      return member === undefined
        ? undefined
        : link(`${member.name}:${member.descriptor}`, `// ${member.name}:${member.descriptor}`);
    }
    case ConstantTag.String: {
      const value = utf8(pool, entry.stringIndex);
      return value === undefined ? undefined : link(`"${value}"`, `// String ${value}`);
    }
    case ConstantTag.Integer:
      return link(String(entry.value), `// int ${String(entry.value)}`);
    case ConstantTag.Utf8:
      return link(entry.value, `// ${entry.value}`);
    case ConstantTag.Float:
    case ConstantTag.Long:
    case ConstantTag.Double:
    case ConstantTag.InterfaceMethodref:
    case ConstantTag.MethodHandle:
    case ConstantTag.MethodType:
    case ConstantTag.Dynamic:
    case ConstantTag.InvokeDynamic:
    case ConstantTag.Module:
    case ConstantTag.Package:
      // Tags the parser reads but never interprets — the kind is all there is to show.
      return {
        index,
        tagName,
        text: tagName,
        chain: [`#${String(index)}`, tagName],
        comment: `// ${tagName}`,
      };
  }
}

const TAG_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(ConstantTag).map(([name, tag]) => [tag, name]),
);

/** Constant pool index of an instruction that has one, from the opcode table. */
export function constantPoolIndexOf(instruction: Instruction): number | undefined {
  const info = lookupOpcode(instruction.opcode);
  if (info?.kind !== 'supported') {
    return undefined;
  }
  const position = info.operands.findIndex((operand) => operand.role === 'constant-pool-index');
  return position < 0 ? undefined : instruction.operands[position];
}

function resolveOperandConstant(
  instruction: Instruction,
  pool: ConstantPool,
): ResolvedConstant | undefined {
  const index = constantPoolIndexOf(instruction);
  return index === undefined ? undefined : resolveConstant(pool, index);
}

interface StackDelta {
  readonly pops: number;
  readonly pushes: number;
}

/**
 * Net effect of one instruction on the operand stack. `undefined` for anything the
 * interpreter cannot run, because past such an instruction the stack shape is unknown.
 */
export function stackDeltaOf(instruction: Instruction, pool: ConstantPool): StackDelta | undefined {
  const info = lookupOpcode(instruction.opcode);
  if (info?.kind !== 'supported') {
    return undefined;
  }
  if (info.stackEffect.kind === 'fixed') {
    return { pops: info.stackEffect.pops, pushes: info.stackEffect.pushes };
  }

  switch (instruction.mnemonic) {
    case 'invokestatic': {
      const callee = calleeOf(instruction, pool);
      if (callee === undefined) {
        return undefined;
      }
      return { pops: callee.arity, pushes: callee.returnsValue ? 1 : 0 };
    }
    case 'ireturn':
      return { pops: 1, pushes: 0 };
    case 'return':
      return { pops: 0, pushes: 0 };
    default:
      return undefined;
  }
}

function effectsOf(instruction: Instruction, pool: ConstantPool): readonly EffectPill[] {
  const info = lookupOpcode(instruction.opcode);
  if (info?.kind !== 'supported') {
    return [];
  }

  if (info.stackEffect.kind === 'fixed') {
    const { pops, pushes } = info.stackEffect;
    return [...pillsFor('pop', pops), ...pillsFor('push', pushes)];
  }

  switch (instruction.mnemonic) {
    case 'invokestatic': {
      const callee = calleeOf(instruction, pool);
      const pops = callee?.arity ?? 0;
      return [...pillsFor('pop', pops), { label: 'push frame' }];
    }
    case 'ireturn':
      return [{ label: 'pop 1' }, { label: 'pop frame' }, { label: 'push int' }];
    case 'return':
      return [{ label: 'pop frame' }];
    default:
      return [];
  }
}

function pillsFor(verb: 'pop' | 'push', count: number): readonly EffectPill[] {
  if (count === 0) {
    return [];
  }
  if (verb === 'push') {
    return [{ label: count === 1 ? 'push int' : `push ${String(count)} ints` }];
  }
  return [{ label: `pop ${String(count)}` }];
}

const COMPARISON: Readonly<Record<string, string>> = {
  if_icmpeq: '=',
  if_icmpne: '≠',
  if_icmplt: '<',
  if_icmpge: '≥',
  if_icmpgt: '>',
  if_icmple: '≤',
  ifeq: '=',
  ifne: '≠',
  iflt: '<',
  ifge: '≥',
  ifgt: '>',
  ifle: '≤',
};

const ARITHMETIC: Readonly<
  Record<string, { readonly symbol: string; readonly apply: (a: number, b: number) => number }>
> = {
  iadd: { symbol: '+', apply: (a, b) => (a + b) | 0 },
  isub: { symbol: '−', apply: (a, b) => (a - b) | 0 },
  imul: { symbol: '×', apply: (a, b) => Math.imul(a, b) },
  idiv: { symbol: '÷', apply: (a, b) => (b === 0 ? 0 : (a / b) | 0) },
  irem: { symbol: 'mod', apply: (a, b) => (b === 0 ? 0 : a % b) },
};

function explain(instruction: Instruction, frame: StackFrame, pool: ConstantPool): string {
  const { mnemonic } = instruction;
  const top = frame.operandStack.at(-1);
  const below = frame.operandStack.at(-2);

  if (lookupOpcode(instruction.opcode)?.kind !== 'supported') {
    return `${mnemonic} is outside the supported instruction subset — running it stops the program here.`;
  }

  if (mnemonic.startsWith('iload')) {
    const slot = slotOf(instruction);
    return `Pushes local ${String(slot)} (${describeSlot(frame, slot)}) onto the operand stack.`;
  }

  if (mnemonic.startsWith('iconst') || mnemonic === 'bipush' || mnemonic === 'sipush') {
    return `Pushes the constant ${String(constantOf(instruction))} onto the operand stack.`;
  }

  if (mnemonic.startsWith('istore')) {
    const slot = slotOf(instruction);
    return `Pops ${valueText(top)} into local slot ${String(slot)} (${nameOfSlot(frame, slot)}).`;
  }

  if (mnemonic === 'iinc') {
    const slot = instruction.operands[0] ?? 0;
    const delta = instruction.operands[1] ?? 0;
    const verb = delta < 0 ? 'Subtracts' : 'Adds';
    return `${verb} ${String(Math.abs(delta))} to local ${String(slot)} (${describeSlot(frame, slot)}) in place, without touching the operand stack.`;
  }

  if (mnemonic === 'pop') {
    return `Discards ${valueText(top)} from the top of the operand stack.`;
  }

  if (mnemonic === 'dup') {
    return `Duplicates ${valueText(top)} on top of the operand stack.`;
  }

  if (mnemonic === 'ineg') {
    return top === undefined
      ? 'Negates the value on top of the operand stack.'
      : `Pops ${String(top)} and pushes ${String(-top | 0)}.`;
  }

  const arithmetic = ARITHMETIC[mnemonic];
  if (arithmetic !== undefined) {
    if (top === undefined || below === undefined) {
      return `Pops two values and pushes their ${mnemonic} result.`;
    }
    if ((mnemonic === 'idiv' || mnemonic === 'irem') && top === 0) {
      return `Pops ${String(below)} and ${String(top)} — dividing by zero, which stops the run with an ArithmeticException.`;
    }
    return `Pops ${String(top)} and ${String(below)} and pushes ${String(below)} ${arithmetic.symbol} ${String(top)} = ${String(arithmetic.apply(below, top))}.`;
  }

  if (mnemonic.startsWith('if')) {
    const operator = COMPARISON[mnemonic] ?? '?';
    const target = instruction.branchTarget;
    const comparesPair = mnemonic.startsWith('if_icmp');
    const left = comparesPair ? below : top;
    const right = comparesPair ? top : 0;
    const popped = comparesPair ? 'Pops both values' : 'Pops the top value';
    return `${popped} and jumps to pc ${String(target ?? 0)} when ${valueText(left)} ${operator} ${String(right)}; otherwise falls through.`;
  }

  if (mnemonic === 'goto') {
    return `Jumps to pc ${String(instruction.branchTarget ?? 0)} — no value is touched.`;
  }

  if (mnemonic === 'invokestatic') {
    const callee = calleeOf(instruction, pool);
    if (callee === undefined) {
      return 'Calls a static method resolved through the constant pool.';
    }
    const args = frame.operandStack.slice(frame.operandStack.length - callee.arity);
    if (args.length === 0) {
      return `Calls ${callee.name}${callee.descriptor} with no arguments and opens a frame for it.`;
    }
    const slots = args.length === 1 ? 'it in slot 0' : `them in slots 0–${String(args.length - 1)}`;
    return `Pops ${args.map(String).join(' and ')} and calls ${callee.name}${callee.descriptor} with ${slots}.`;
  }

  if (mnemonic === 'ireturn') {
    return `Pops ${valueText(top)}, discards the frame of ${frame.methodName} and pushes the value onto the caller's stack.`;
  }

  if (mnemonic === 'return') {
    return `Discards the frame of ${frame.methodName} and returns nothing.`;
  }

  return `Executes ${mnemonic}.`;
}

function valueText(value: number | undefined): string {
  return value === undefined ? 'the top value' : String(value);
}

function nameOfSlot(frame: StackFrame, slot: number): string {
  return frame.localNames[slot] ?? `slot ${String(slot)}`;
}

function describeSlot(frame: StackFrame, slot: number): string {
  const value = frame.locals[slot];
  const shown = value === undefined ? 'uninitialised' : String(value);
  return `${nameOfSlot(frame, slot)} = ${shown}`;
}

/** Local slot addressed by a load/store — from the mnemonic suffix or from the operand. */
function slotOf(instruction: Instruction): number {
  const suffix = instruction.mnemonic.split('_')[1];
  if (suffix !== undefined && /^\d+$/.test(suffix)) {
    return Number(suffix);
  }
  return instruction.operands[0] ?? 0;
}

function constantOf(instruction: Instruction): number {
  const suffix = instruction.mnemonic.split('_')[1];
  if (suffix === 'm1') {
    return -1;
  }
  if (suffix !== undefined && /^\d+$/.test(suffix)) {
    return Number(suffix);
  }
  return instruction.operands[0] ?? 0;
}

interface Callee {
  readonly name: string;
  readonly descriptor: string;
  readonly arity: number;
  readonly returnsValue: boolean;
}

function calleeOf(instruction: Instruction, pool: ConstantPool): Callee | undefined {
  const index = constantPoolIndexOf(instruction);
  const entry = index === undefined ? undefined : (pool[index] ?? undefined);
  if (entry?.tag !== ConstantTag.Methodref) {
    return undefined;
  }
  const member = nameAndType(pool, entry.nameAndTypeIndex);
  if (member === undefined) {
    return undefined;
  }

  const parsed = parseDescriptor(member.descriptor);
  if (parsed === undefined) {
    return undefined;
  }
  return {
    name: member.name,
    descriptor: member.descriptor,
    arity: parsed.arity,
    returnsValue: parsed.returnsValue,
  };
}

function parseDescriptor(
  descriptor: string,
): { readonly arity: number; readonly returnsValue: boolean } | undefined {
  try {
    const parsed = parseMethodDescriptor(descriptor);
    return { arity: parsed.params.length, returnsValue: parsed.returnType.kind !== 'void' };
  } catch (error) {
    if (!isClassFileError(error)) {
      throw error;
    }
    return undefined;
  }
}

function className(pool: ConstantPool, index: number): string | undefined {
  const entry = pool[index] ?? undefined;
  return entry?.tag === ConstantTag.Class ? utf8(pool, entry.nameIndex) : undefined;
}

function nameAndType(
  pool: ConstantPool,
  index: number,
): { readonly name: string; readonly descriptor: string } | undefined {
  const entry = pool[index] ?? undefined;
  if (entry?.tag !== ConstantTag.NameAndType) {
    return undefined;
  }
  const name = utf8(pool, entry.nameIndex);
  const descriptor = utf8(pool, entry.descriptorIndex);
  return name === undefined || descriptor === undefined ? undefined : { name, descriptor };
}

function utf8(pool: ConstantPool, index: number): string | undefined {
  const entry = pool[index] ?? undefined;
  return entry?.tag === ConstantTag.Utf8 ? entry.value : undefined;
}

/**
 * Walks the method forward from the current instruction, tracking the operand stack height,
 * and reports which instruction eventually consumes the value at `targetIndex`. Straight-line
 * only — good enough to label a value as "waiting for imul" while a call runs.
 */
function consumerOf(
  listing: MethodListing,
  pool: ConstantPool,
  fromOffset: number,
  height: number,
  targetIndex: number,
): string | undefined {
  const start = listing.instructions.findIndex((entry) => entry.offset === fromOffset);
  if (start < 0) {
    return undefined;
  }

  let stackHeight = height;
  for (let index = start; index < listing.instructions.length; index++) {
    const instruction = listing.instructions[index];
    if (instruction === undefined) {
      return undefined;
    }
    const effect = stackDeltaOf(instruction, pool);
    if (effect === undefined) {
      return undefined;
    }
    if (stackHeight - effect.pops <= targetIndex) {
      return instruction.mnemonic;
    }
    stackHeight = stackHeight - effect.pops + effect.pushes;
  }
  return undefined;
}
