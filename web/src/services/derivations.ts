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
// int semantics live in one place: the explanations quote the interpreter, not a copy of it.
import { iadd, idiv, imul, ineg, irem, isub } from '../core/interpreter/int32';

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
  listing: MethodListing | undefined,
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
    explanation: explain(instruction, frame, listing, pool),
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

  for (let taken = 0; taken < effect.pops && topIndex - taken >= 0; taken++) {
    roles[topIndex - taken] = operandRole(instruction.mnemonic, effect.pops, taken);
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

/**
 * What one cell about to be popped is *for*. Two cells that both read "operand" say nothing:
 * on a binary instruction the JVM order matters, so they are named by position, and a call
 * names the argument slot each value lands in.
 *
 * @param taken 0 for the top of the stack, counting downwards
 */
function operandRole(mnemonic: string, pops: number, taken: number): string {
  if (mnemonic === 'invokestatic') {
    return `→ arg ${String(pops - 1 - taken)}`;
  }
  // `value1 op value2` with value2 on top (JVMS §6.5 iadd, if_icmp<cond>).
  if (pops === 2) {
    return taken === 0 ? '→ right' : '→ left';
  }
  return `→ ${mnemonic}`;
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

/** Only ever applied to the operands of an instruction the run is about to execute. */
const ARITHMETIC: Readonly<
  Record<string, { readonly symbol: string; readonly apply: (a: number, b: number) => number }>
> = {
  iadd: { symbol: '+', apply: iadd },
  isub: { symbol: '−', apply: isub },
  imul: { symbol: '×', apply: imul },
  idiv: { symbol: '÷', apply: idiv },
  irem: { symbol: 'mod', apply: irem },
};

function explain(
  instruction: Instruction,
  frame: StackFrame,
  listing: MethodListing | undefined,
  pool: ConstantPool,
): string {
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
    return `Pops ${valueText(top)} into local slot ${String(slot)} (${storedName(frame, listing, instruction, slot)}).`;
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
      : `Pops ${String(top)} and pushes ${String(ineg(top))}.`;
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
    const premise = `${popped} and compares ${valueText(left)} ${operator} ${valueText(right)}`;

    // The snapshot already holds the values, so the branch is not a maybe — it is decided.
    const taken = comparisonHolds(mnemonic, left, right);
    if (taken === undefined) {
      return `${premise}; a true comparison jumps to pc ${String(target ?? 0)}, otherwise execution falls through.`;
    }
    const fallThrough = offsetAfter(listing, instruction.offset);
    return taken
      ? `${premise} — true, so execution jumps to pc ${String(target ?? 0)}.`
      : `${premise} — false, so execution falls through to pc ${String(fallThrough ?? instruction.offset)}.`;
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
    const resume = offsetAfter(listing, instruction.offset);
    // Where control actually goes, both ways: into the callee now, back here on the return.
    const handover =
      resume === undefined
        ? ` — the callee starts at pc 0.`
        : ` — the callee starts at pc 0 and ${frame.methodName} resumes at pc ${String(resume)}.`;
    if (args.length === 0) {
      return `Calls ${callee.name}${callee.descriptor} with no arguments and opens a frame for it${handover}`;
    }
    const slots = args.length === 1 ? 'it in slot 0' : `them in slots 0–${String(args.length - 1)}`;
    return `Pops ${args.map(String).join(' and ')} and calls ${callee.name}${callee.descriptor} with ${slots}${handover}`;
  }

  if (mnemonic === 'ireturn') {
    return `Pops ${valueText(top)}, discards the frame of ${frame.methodName} and pushes the value onto the caller's stack.`;
  }

  if (mnemonic === 'return') {
    return `Discards the frame of ${frame.methodName} and returns nothing.`;
  }

  return `Executes ${mnemonic}.`;
}

/**
 * What a mnemonic does in general, with no snapshot behind it — the tooltip on every row of
 * the listing, including the rows this run never reached.
 *
 * By family rather than per opcode: `iload_0` and `iload_3` differ only in the slot they
 * name, and the opcode table already knows which family an instruction belongs to.
 */
export function explainMnemonic(mnemonic: string): string | undefined {
  const family = MNEMONIC_HELP[mnemonic];
  if (family !== undefined) {
    return family;
  }

  const slot = /^i(load|store)_(\d)$/.exec(mnemonic);
  if (slot !== null) {
    return slot[1] === 'load'
      ? `Pushes local variable slot ${String(slot[2])} onto the operand stack.`
      : `Pops the top of the operand stack into local variable slot ${String(slot[2])}.`;
  }

  const constant = /^iconst_(m1|\d)$/.exec(mnemonic);
  if (constant !== null) {
    const value = constant[1] === 'm1' ? '−1' : constant[1];
    return `Pushes the int constant ${String(value)} onto the operand stack.`;
  }

  return undefined;
}

const MNEMONIC_HELP: Readonly<Record<string, string>> = {
  nop: 'Does nothing.',
  bipush: 'Pushes a one-byte signed constant, widened to an int.',
  sipush: 'Pushes a two-byte signed constant, widened to an int.',
  iload: 'Pushes the local variable slot named by the operand onto the operand stack.',
  istore: 'Pops the top of the operand stack into the local variable slot named by the operand.',
  iinc: 'Adds a constant to a local variable in place, without touching the operand stack.',
  pop: 'Discards the top value of the operand stack.',
  dup: 'Duplicates the top value of the operand stack.',
  iadd: 'Pops two ints and pushes their sum, wrapping around on overflow.',
  isub: 'Pops two ints and pushes the lower minus the upper.',
  imul: 'Pops two ints and pushes their product, wrapping around on overflow.',
  idiv: 'Pops two ints and pushes the quotient, truncated towards zero; zero divisor throws.',
  irem: 'Pops two ints and pushes the remainder of the division.',
  ineg: 'Pops an int and pushes its negation.',
  if_icmpeq: 'Pops two ints and branches when they are equal.',
  if_icmpne: 'Pops two ints and branches when they differ.',
  if_icmplt: 'Pops two ints and branches when the lower one is smaller.',
  if_icmpge: 'Pops two ints and branches when the lower one is greater or equal.',
  if_icmpgt: 'Pops two ints and branches when the lower one is greater.',
  if_icmple: 'Pops two ints and branches when the lower one is smaller or equal.',
  ifeq: 'Pops an int and branches when it is zero.',
  ifne: 'Pops an int and branches when it is not zero.',
  iflt: 'Pops an int and branches when it is negative.',
  ifge: 'Pops an int and branches when it is zero or positive.',
  ifgt: 'Pops an int and branches when it is positive.',
  ifle: 'Pops an int and branches when it is zero or negative.',
  goto: 'Jumps to the target offset unconditionally.',
  invokestatic:
    'Resolves a static method through the constant pool, pops its arguments into the new ' +
    "frame's slots and starts executing it.",
  ireturn: "Pops an int, discards this frame and pushes the value onto the caller's stack.",
  return: 'Discards this frame and returns no value.',
};

function valueText(value: number | undefined): string {
  return value === undefined ? 'the top value' : String(value);
}

/** Whether the branch is taken, or `undefined` when a value is missing from the snapshot. */
function comparisonHolds(
  mnemonic: string,
  left: number | undefined,
  right: number | undefined,
): boolean | undefined {
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const operator = COMPARISON[mnemonic];
  if (operator === '=') {
    return left === right;
  }
  if (operator === '≠') {
    return left !== right;
  }
  if (operator === '<') {
    return left < right;
  }
  if (operator === '≥') {
    return left >= right;
  }
  if (operator === '>') {
    return left > right;
  }
  if (operator === '≤') {
    return left <= right;
  }
  return undefined;
}

/** Offset of the instruction laid out after `offset` — where a branch falls through to. */
function offsetAfter(listing: MethodListing | undefined, offset: number): number | undefined {
  if (listing === undefined) {
    return undefined;
  }
  const index = listing.instructions.findIndex((entry) => entry.offset === offset);
  return index < 0 ? undefined : listing.instructions[index + 1]?.offset;
}

function nameOfSlot(frame: StackFrame, slot: number): string {
  return frame.localNames[slot] ?? `slot ${String(slot)}`;
}

/**
 * Name of the slot a store writes to. javac opens the scope of a variable at the instruction
 * *after* the store that initialises it (JVMS §4.7.13), so the frame's own names — taken at
 * the store itself — still call the slot anonymous. The value being stored is the variable,
 * so the name is looked up one instruction ahead.
 */
function storedName(
  frame: StackFrame,
  listing: MethodListing | undefined,
  instruction: Instruction,
  slot: number,
): string {
  if (listing !== undefined) {
    const index = listing.instructions.findIndex((entry) => entry.offset === instruction.offset);
    const nextOffset = index < 0 ? undefined : listing.instructions[index + 1]?.offset;
    const name = nextOffset === undefined ? undefined : localNameAt(listing, nextOffset, slot);
    if (name !== undefined) {
      return name;
    }
  }
  return nameOfSlot(frame, slot);
}

/** LocalVariableTable name of `slot` in scope at `pc`, if the table has one. */
function localNameAt(listing: MethodListing, pc: number, slot: number): string | undefined {
  return listing.localVariables.find(
    (entry) => entry.index === slot && pc >= entry.startPc && pc < entry.startPc + entry.length,
  )?.name;
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
 * and reports which instruction eventually consumes the value at `targetIndex`.
 *
 * Conditional branches are followed through to the fall-through path, but an unconditional
 * `goto` never falls through: reading straight past it would blame whatever instruction the
 * loop body happens to be laid out next to. Each instruction is visited at most once, so a
 * backward jump ends the walk instead of looping.
 */
function consumerOf(
  listing: MethodListing,
  pool: ConstantPool,
  fromOffset: number,
  height: number,
  targetIndex: number,
): string | undefined {
  const indexByOffset = new Map(listing.instructions.map((entry, index) => [entry.offset, index]));
  const start = indexByOffset.get(fromOffset);
  if (start === undefined) {
    return undefined;
  }

  const visited = new Set<number>();
  let stackHeight = height;
  for (let index = start; index < listing.instructions.length; index++) {
    const instruction = listing.instructions[index];
    if (instruction === undefined || visited.has(index)) {
      return undefined;
    }
    visited.add(index);

    const effect = stackDeltaOf(instruction, pool);
    if (effect === undefined) {
      return undefined;
    }
    if (stackHeight - effect.pops <= targetIndex) {
      return instruction.mnemonic;
    }
    stackHeight = stackHeight - effect.pops + effect.pushes;

    if (instruction.mnemonic === 'goto') {
      const target =
        instruction.branchTarget === undefined
          ? undefined
          : indexByOffset.get(instruction.branchTarget);
      if (target === undefined) {
        return undefined;
      }
      // The loop increment takes it to `target`.
      index = target - 1;
    }
  }
  return undefined;
}
