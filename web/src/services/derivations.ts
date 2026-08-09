import {
  ConstantTag,
  isClassFileError,
  parseMethodDescriptor,
  type ClassFile,
  type ConstantPool,
} from '../core/classfile';
import { arrayTypeName, lookupOpcode, T_INT, type Instruction } from '../core/disassembler';
import type { ArrayObject, HeapObject, Snapshot, StackFrame } from '../core/interpreter';
import { iadd, idiv, imul, ineg, irem, isub } from '../core/interpreter/int32';

import type { MethodListing } from './program';

export interface EffectPill {
  readonly label: string;
}

export interface NextInstructionSummary {
  readonly effects: readonly EffectPill[];
  readonly explanation: string;
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
    explanation: explain(instruction, frame, snapshot.heap ?? [], listing, pool),
    cpChain: constant?.chain,
  };
}

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

function operandRole(mnemonic: string, pops: number, taken: number): string {
  if (mnemonic === 'invokestatic') {
    return `→ arg ${String(pops - 1 - taken)}`;
  }
  const named = ARRAY_OPERAND_ROLES[mnemonic]?.[taken];
  if (named !== undefined) {
    return named;
  }
  if (pops === 2) {
    return taken === 0 ? '→ right' : '→ left';
  }
  return `→ ${mnemonic}`;
}

const ARRAY_OPERAND_ROLES: Readonly<Record<string, readonly string[]>> = {
  iaload: ['→ index', '→ array'],
  iastore: ['→ value', '→ index', '→ array'],
  arraylength: ['→ array'],
  newarray: ['→ length'],
};

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
  readonly tagName: string;
  readonly text: string;
  readonly chain: readonly string[];
  readonly comment: string;
}

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

export function tagNameOf(tag: number): string {
  return TAG_NAMES.get(tag) ?? `tag ${String(tag)}`;
}

export function constantPoolIndexOf(instruction: Instruction): number | undefined {
  const info = lookupOpcode(instruction.opcode);
  if (info === undefined) {
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
    return [...popPills(pops), ...pushPills(pushes, pushedKindOf(instruction.mnemonic))];
  }

  switch (instruction.mnemonic) {
    case 'invokestatic': {
      const callee = calleeOf(instruction, pool);
      return [...popPills(callee?.arity ?? 0), { label: 'push frame' }];
    }
    case 'ireturn':
      return [{ label: 'pop 1' }, { label: 'pop frame' }, { label: 'push int' }];
    case 'return':
      return [{ label: 'pop frame' }];
    default:
      return [];
  }
}

function popPills(count: number): readonly EffectPill[] {
  return count === 0 ? [] : [{ label: `pop ${String(count)}` }];
}

function pushPills(count: number, pushed: string): readonly EffectPill[] {
  if (count === 0) {
    return [];
  }
  return [{ label: count === 1 ? `push ${pushed}` : `push ${String(count)} ${pushed}s` }];
}

const REFERENCE_PUSHING: ReadonlySet<string> = new Set([
  'aconst_null',
  'newarray',
  'aload',
  'aload_0',
  'aload_1',
  'aload_2',
  'aload_3',
]);

function pushedKindOf(mnemonic: string): string {
  return REFERENCE_PUSHING.has(mnemonic) ? 'ref' : 'int';
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
  iadd: { symbol: '+', apply: iadd },
  isub: { symbol: '−', apply: isub },
  imul: { symbol: '×', apply: imul },
  idiv: { symbol: '÷', apply: idiv },
  irem: { symbol: 'mod', apply: irem },
};

function explain(
  instruction: Instruction,
  frame: StackFrame,
  heap: readonly HeapObject[],
  listing: MethodListing | undefined,
  pool: ConstantPool,
): string {
  const { mnemonic } = instruction;
  const top = frame.operandStack.at(-1);
  const below = frame.operandStack.at(-2);

  if (lookupOpcode(instruction.opcode)?.kind !== 'supported') {
    return `${mnemonic} is outside the supported instruction subset; running it stops the program here.`;
  }

  const array = explainArray(instruction, frame, heap);
  if (array !== undefined) {
    return array;
  }

  if (mnemonic.startsWith('iload')) {
    const slot = slotOf(instruction);
    return `Pushes local ${String(slot)} (${describeSlot(frame, slot, heap)}) onto the operand stack.`;
  }

  if (mnemonic.startsWith('aload')) {
    const slot = slotOf(instruction);
    return `Pushes the reference in local ${String(slot)} (${describeSlot(frame, slot, heap)}) onto the operand stack.`;
  }

  if (mnemonic === 'aconst_null') {
    return 'Pushes the null reference onto the operand stack.';
  }

  if (mnemonic.startsWith('iconst') || mnemonic === 'bipush' || mnemonic === 'sipush') {
    return `Pushes the constant ${String(constantOf(instruction))} onto the operand stack.`;
  }

  if (mnemonic.startsWith('istore')) {
    const slot = slotOf(instruction);
    return `Pops ${valueText(top)} into local slot ${String(slot)} (${storedName(frame, listing, instruction, slot)}).`;
  }

  if (mnemonic.startsWith('astore')) {
    const slot = slotOf(instruction);
    return `Pops the reference to ${referenceText(heap, top)} into local slot ${String(slot)} (${storedName(frame, listing, instruction, slot)}).`;
  }

  if (mnemonic === 'iinc') {
    const slot = instruction.operands[0] ?? 0;
    const delta = instruction.operands[1] ?? 0;
    const verb = delta < 0 ? 'Subtracts' : 'Adds';
    return `${verb} ${String(Math.abs(delta))} to local ${String(slot)} (${describeSlot(frame, slot, heap)}) in place, without touching the operand stack.`;
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
      return `Pops ${String(below)} and ${String(top)}: dividing by zero, which stops the run with an ArithmeticException.`;
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

    const taken = comparisonHolds(mnemonic, left, right);
    if (taken === undefined) {
      return `${premise}; a true comparison jumps to pc ${String(target ?? 0)}, otherwise execution falls through.`;
    }
    const fallThrough = offsetAfter(listing, instruction.offset);
    return taken
      ? `${premise}: true, so execution jumps to pc ${String(target ?? 0)}.`
      : `${premise}: false, so execution falls through to pc ${String(fallThrough ?? instruction.offset)}.`;
  }

  if (mnemonic === 'goto') {
    return `Jumps to pc ${String(instruction.branchTarget ?? 0)}; no value is touched.`;
  }

  if (mnemonic === 'invokestatic') {
    const callee = calleeOf(instruction, pool);
    if (callee === undefined) {
      return 'Calls a static method resolved through the constant pool.';
    }
    const args = frame.operandStack.slice(frame.operandStack.length - callee.arity);
    const resume = offsetAfter(listing, instruction.offset);
    const handover =
      resume === undefined
        ? `. The callee starts at pc 0.`
        : `. The callee starts at pc 0 and ${frame.methodName} resumes at pc ${String(resume)}.`;
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

function explainArray(
  instruction: Instruction,
  frame: StackFrame,
  heap: readonly HeapObject[],
): string | undefined {
  const { mnemonic } = instruction;
  const top = frame.operandStack.at(-1);
  const below = frame.operandStack.at(-2);

  switch (mnemonic) {
    case 'newarray': {
      const atype = instruction.operands[0] ?? 0;
      if (atype !== T_INT) {
        const element = arrayTypeName(atype) ?? `atype ${String(atype)}`;
        return `Allocates ${element}[]. This interpreter only allocates int arrays, so running it stops the program here.`;
      }
      return top === undefined
        ? 'Allocates a zero-filled int array as long as the value on top of the operand stack.'
        : `Allocates int[${String(top)}], zero-filled, and pushes a reference to it.`;
    }

    case 'arraylength': {
      const array = arrayAt(heap, top);
      return array === undefined
        ? 'Pops an array reference and pushes the length of the array.'
        : `Pops the reference to int[${String(array.length)}] and pushes its length, ${String(array.length)}.`;
    }

    case 'iaload': {
      const array = arrayAt(heap, below);
      if (array === undefined || top === undefined) {
        return 'Pops an array reference and an index and pushes the element stored there.';
      }
      const element = array.elements[top];
      return element === undefined
        ? `Reads index ${String(top)} of int[${String(array.length)}]: outside the array, which stops the run with an ArrayIndexOutOfBoundsException.`
        : `Pushes ${String(element)}, the element at index ${String(top)} of int[${String(array.length)}].`;
    }

    case 'iastore': {
      const array = arrayAt(heap, frame.operandStack.at(-3));
      if (array === undefined || top === undefined || below === undefined) {
        return 'Pops an array reference, an index and a value, and stores the value at that index.';
      }
      return below < 0 || below >= array.length
        ? `Stores ${String(top)} at index ${String(below)} of int[${String(array.length)}]: outside the array, which stops the run with an ArrayIndexOutOfBoundsException.`
        : `Stores ${String(top)} at index ${String(below)} of int[${String(array.length)}].`;
    }

    default:
      return undefined;
  }
}

function arrayAt(
  heap: readonly HeapObject[],
  reference: number | undefined,
): ArrayObject | undefined {
  const object = reference === undefined ? undefined : heap[reference];
  return object?.kind === 'int-array' ? object : undefined;
}

function referenceText(heap: readonly HeapObject[], reference: number | undefined): string {
  const object = reference === undefined ? undefined : heap[reference];
  if (object === undefined) {
    return 'null';
  }
  return object.kind === 'int-array' ? `int[${String(object.length)}]` : object.className;
}

export function explainMnemonic(mnemonic: string): string | undefined {
  const family = MNEMONIC_HELP[mnemonic];
  if (family !== undefined) {
    return family;
  }

  const slot = /^([ai])(load|store)_(\d)$/.exec(mnemonic);
  if (slot !== null) {
    const what = slot[1] === 'a' ? 'the reference in local variable slot' : 'local variable slot';
    return slot[2] === 'load'
      ? `Pushes ${what} ${String(slot[3])} onto the operand stack.`
      : `Pops the top of the operand stack into local variable slot ${String(slot[3])}.`;
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
  aconst_null: 'Pushes the null reference onto the operand stack.',
  bipush: 'Pushes a one-byte signed constant, widened to an int.',
  sipush: 'Pushes a two-byte signed constant, widened to an int.',
  iload: 'Pushes the local variable slot named by the operand onto the operand stack.',
  istore: 'Pops the top of the operand stack into the local variable slot named by the operand.',
  aload: 'Pushes the reference held by the local variable slot named by the operand.',
  astore:
    'Pops a reference off the operand stack into the local variable slot named by the operand.',
  newarray:
    'Pops a length and allocates a zero-filled array of the primitive type named by the ' +
    'operand, pushing the reference to it.',
  arraylength: 'Pops an array reference and pushes the length of the array.',
  iaload: 'Pops an array reference and an index and pushes the int stored at that index.',
  iastore: 'Pops an array reference, an index and an int, and stores the int at that index.',
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

function localNameAt(listing: MethodListing, pc: number, slot: number): string | undefined {
  return listing.localVariables.find(
    (entry) => entry.index === slot && pc >= entry.startPc && pc < entry.startPc + entry.length,
  )?.name;
}

function describeSlot(frame: StackFrame, slot: number, heap: readonly HeapObject[]): string {
  const value = frame.locals[slot];
  const shown =
    value === undefined
      ? 'uninitialised'
      : frame.localKinds?.[slot] === 'ref'
        ? referenceText(heap, value)
        : String(value);
  return `${nameOfSlot(frame, slot)} = ${shown}`;
}

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
      index = target - 1;
    }
  }
  return undefined;
}
