import {
  classNameAt,
  ConstantTag,
  nameAndTypeAt,
  poolEntry,
  utf8At,
  type ClassFile,
  type ConstantPool,
} from '../../core/classfile';
import { arrayTypeName, isSupportedOpcode, T_INT, type Instruction } from '../../core/disassembler';
import {
  EXTERNAL_FIELDS,
  EXTERNAL_METHODS,
  i2b,
  i2c,
  i2s,
  iadd,
  iand,
  idiv,
  imul,
  ineg,
  ior,
  irem,
  ishl,
  ishr,
  isub,
  iushr,
  ixor,
  memberKey,
  NULL_REFERENCE,
  opensFrame,
  type ArrayObject,
  type ExternalValue,
  type HeapObject,
  type Snapshot,
  type StackFrame,
  type ValueKind,
} from '../../core/interpreter';

import { constantPoolIndexOf, resolveOperandConstant } from './constant-pool';
import { describeValue } from './heap-view';
import { calleeOf, memberOf, ownerOf, type Member } from './member-refs';
import {
  baseMnemonicOf,
  knownStaticFields,
  OPCODE_NOTES,
  OPERAND_ADDRESSING,
  stackDeltaOf,
  type PushedKind,
} from './opcode-notes';
import type { MethodListing } from '../loading/program';

export interface EffectPill {
  readonly label: string;
}

export interface NextInstructionSummary {
  readonly effects: readonly EffectPill[];
  readonly explanation: string;
  readonly cpChain?: readonly string[] | undefined;
}

interface ExplainContext {
  readonly instruction: Instruction;
  readonly frame: StackFrame;
  readonly depth: number;
  readonly heap: readonly HeapObject[];
  readonly externals: readonly ExternalValue[];
  readonly listing: MethodListing | undefined;
  readonly classFile: ClassFile;
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

  const context: ExplainContext = {
    instruction,
    frame,
    depth: snapshot.callStack.length,
    heap: snapshot.heap,
    externals: snapshot.externals,
    listing,
    classFile,
  };

  return {
    effects: effectsOf(context),
    explanation: explain(context),
    cpChain: resolveOperandConstant(instruction, classFile.constantPool)?.chain,
  };
}

function effectsOf(context: ExplainContext): readonly EffectPill[] {
  const { instruction } = context;
  if (!isSupportedOpcode(instruction.opcode)) {
    return [];
  }
  const delta = stackDeltaOf(instruction, context.classFile.constantPool);
  if (delta === undefined) {
    return [];
  }

  const note = OPCODE_NOTES[baseMnemonicOf(instruction)];
  const pushed = pushedKindOf(context, delta.pops);
  if (note?.frame === 'return') {
    const returned = context.depth > 1 ? delta.pops : 0;
    return [...popPills(delta.pops), { label: 'pop frame' }, ...pushPills(returned, pushed)];
  }
  if (note?.frame === 'call' && calleeOpensFrame(context)) {
    return [...popPills(delta.pops), { label: 'push frame' }];
  }
  return [...popPills(delta.pops), ...pushPills(delta.pushes, pushed)];
}

function popPills(count: number): readonly EffectPill[] {
  return count === 0 ? [] : [{ label: `pop ${String(count)}` }];
}

function pushPills(count: number, pushed: PushedKind | undefined): readonly EffectPill[] {
  if (count === 0) {
    return [];
  }
  if (pushed === undefined) {
    return [{ label: `push ${String(count)}` }];
  }
  return [{ label: count === 1 ? `push ${pushed}` : `push ${String(count)} ${pushed}s` }];
}

function pushedKindOf(context: ExplainContext, copied: number): PushedKind | undefined {
  const pushed = OPCODE_NOTES[baseMnemonicOf(context.instruction)]?.pushedKind;
  if (pushed === 'descriptor') {
    return descriptorKindOf(context.instruction, context.classFile.constantPool);
  }
  if (pushed === 'stack-top') {
    return copiedKindOf(context.frame, copied);
  }
  return pushed ?? 'int';
}

function copiedKindOf(frame: StackFrame, copied: number): PushedKind | undefined {
  let seen: PushedKind | undefined;
  for (let depth = 1; depth <= copied; depth++) {
    const index = frame.operandStack.length - depth;
    const kind: PushedKind = frame.operandKinds[index] === 'int' ? 'int' : 'ref';
    if (seen === undefined) {
      seen = kind;
    } else if (seen !== kind) {
      return undefined;
    }
  }
  return seen ?? 'ref';
}

function descriptorKindOf(instruction: Instruction, pool: ConstantPool): PushedKind {
  const index = constantPoolIndexOf(instruction);
  const entry = index === undefined ? undefined : poolEntry(pool, index);
  if (entry?.tag === ConstantTag.String) {
    return 'ref';
  }
  if (entry?.tag === ConstantTag.Methodref) {
    return calleeOf(instruction, pool)?.returnsReference === true ? 'ref' : 'int';
  }
  if (entry?.tag === ConstantTag.Fieldref) {
    const member = nameAndTypeAt(pool, entry.nameAndTypeIndex);
    return member !== undefined && isReferenceDescriptor(member.descriptor) ? 'ref' : 'int';
  }
  return 'int';
}

function isReferenceDescriptor(descriptor: string): boolean {
  return descriptor.startsWith('L') || descriptor.startsWith('[');
}

interface Comparison {
  readonly symbol: string;
  readonly holds: (left: number, right: number) => boolean;
}

const EQUAL: Comparison = { symbol: '=', holds: (left, right) => left === right };
const NOT_EQUAL: Comparison = { symbol: '≠', holds: (left, right) => left !== right };
const LESS: Comparison = { symbol: '<', holds: (left, right) => left < right };
const AT_LEAST: Comparison = { symbol: '≥', holds: (left, right) => left >= right };
const GREATER: Comparison = { symbol: '>', holds: (left, right) => left > right };
const AT_MOST: Comparison = { symbol: '≤', holds: (left, right) => left <= right };

const COMPARISON: Readonly<Record<string, Comparison>> = {
  if_icmpeq: EQUAL,
  if_icmpne: NOT_EQUAL,
  if_icmplt: LESS,
  if_icmpge: AT_LEAST,
  if_icmpgt: GREATER,
  if_icmple: AT_MOST,
  ifeq: EQUAL,
  ifne: NOT_EQUAL,
  iflt: LESS,
  ifge: AT_LEAST,
  ifgt: GREATER,
  ifle: AT_MOST,
};

const ARITHMETIC: Readonly<
  Record<string, { readonly symbol: string; readonly apply: (a: number, b: number) => number }>
> = {
  iadd: { symbol: '+', apply: iadd },
  isub: { symbol: '−', apply: isub },
  imul: { symbol: '×', apply: imul },
  idiv: { symbol: '÷', apply: idiv },
  irem: { symbol: 'mod', apply: irem },
  ishl: { symbol: '<<', apply: ishl },
  ishr: { symbol: '>>', apply: ishr },
  iushr: { symbol: '>>>', apply: iushr },
  iand: { symbol: '&', apply: iand },
  ior: { symbol: '|', apply: ior },
  ixor: { symbol: '^', apply: ixor },
};

const NARROWING: Readonly<
  Record<string, { readonly apply: (value: number) => number; readonly kept: string }>
> = {
  i2b: { apply: i2b, kept: 'the low eight bits read as a signed byte' },
  i2c: { apply: i2c, kept: 'the low sixteen bits read as an unsigned char' },
  i2s: { apply: i2s, kept: 'the low sixteen bits read as a signed short' },
};

function explain(context: ExplainContext): string {
  const { instruction } = context;

  if (!isSupportedOpcode(instruction.opcode)) {
    return `${instruction.mnemonic} is outside the supported instruction subset; running it stops the program here.`;
  }

  const mnemonic = baseMnemonicOf(instruction);
  return (
    explainArray(context) ??
    explainLocals(context) ??
    explainStack(context) ??
    explainArithmetic(context) ??
    explainBranch(context) ??
    explainCall(context) ??
    explainObject(context) ??
    OPCODE_NOTES[mnemonic]?.help ??
    `Executes ${mnemonic}.`
  );
}

function explainLocals(context: ExplainContext): string | undefined {
  const { instruction, frame } = context;
  const mnemonic = baseMnemonicOf(instruction);

  if (mnemonic.startsWith('iload')) {
    const slot = slotOf(instruction);
    return `Pushes local ${String(slot)} (${describeSlot(context, slot)}) onto the operand stack.`;
  }

  if (mnemonic.startsWith('aload')) {
    const slot = slotOf(instruction);
    return `Pushes the reference in local ${String(slot)} (${describeSlot(context, slot)}) onto the operand stack.`;
  }

  if (mnemonic.startsWith('iconst') || mnemonic === 'bipush' || mnemonic === 'sipush') {
    return `Pushes the constant ${String(constantOf(instruction))} onto the operand stack.`;
  }

  if (mnemonic.startsWith('istore')) {
    const slot = slotOf(instruction);
    return `Pops ${valueText(frame.operandStack.at(-1))} into local slot ${String(slot)} (${storedName(context, slot)}).`;
  }

  if (mnemonic.startsWith('astore')) {
    const slot = slotOf(instruction);
    return `Pops the reference to ${stackText(context, 1)} into local slot ${String(slot)} (${storedName(context, slot)}).`;
  }

  if (mnemonic.startsWith('iinc')) {
    const slot = instruction.operands[0] ?? 0;
    const delta = instruction.operands[1] ?? 0;
    const change = delta < 0 ? 'Subtracts' : 'Adds';
    const preposition = delta < 0 ? 'from' : 'to';
    return `${change} ${String(Math.abs(delta))} ${preposition} local ${String(slot)} (${describeSlot(context, slot)}) in place, without touching the operand stack.`;
  }

  return undefined;
}

function explainStack(context: ExplainContext): string | undefined {
  const top = stackText(context, 1);
  const below = stackText(context, 2);

  switch (context.instruction.mnemonic) {
    case 'pop':
      return `Discards ${top} from the top of the operand stack.`;
    case 'pop2':
      return `Discards ${top} and ${below} from the top of the operand stack.`;
    case 'dup':
      return `Duplicates ${top} on top of the operand stack.`;
    case 'dup_x1':
      return `Duplicates ${top} and inserts the copy below ${below}.`;
    case 'dup_x2':
      return `Duplicates ${top} and inserts the copy below ${stackText(context, 3)}.`;
    case 'dup2':
      return `Duplicates ${below} and ${top}, leaving both pairs on the operand stack.`;
    case 'dup2_x1':
      return `Duplicates ${below} and ${top} and inserts the copies below ${stackText(context, 3)}.`;
    case 'dup2_x2':
      return `Duplicates ${below} and ${top} and inserts the copies below ${stackText(context, 4)}.`;
    case 'swap':
      return `Exchanges ${top} and ${below} on top of the operand stack.`;
    default:
      return undefined;
  }
}

function explainArithmetic(context: ExplainContext): string | undefined {
  const { mnemonic } = context.instruction;
  const top = context.frame.operandStack.at(-1);
  const below = context.frame.operandStack.at(-2);

  if (mnemonic === 'ineg') {
    return top === undefined
      ? 'Negates the value on top of the operand stack.'
      : `Pops ${String(top)} and pushes ${String(ineg(top))}.`;
  }

  const narrowing = NARROWING[mnemonic];
  if (narrowing !== undefined) {
    return top === undefined
      ? `Pops an int and pushes ${narrowing.kept}.`
      : `Pops ${String(top)} and pushes ${String(narrowing.apply(top))}, ${narrowing.kept}.`;
  }

  const arithmetic = ARITHMETIC[mnemonic];
  if (arithmetic === undefined) {
    return undefined;
  }
  if (top === undefined || below === undefined) {
    return `Pops two values and pushes their ${mnemonic} result.`;
  }
  if ((mnemonic === 'idiv' || mnemonic === 'irem') && top === 0) {
    return `Pops ${String(top)} and ${String(below)}: dividing by zero, which stops the run with an ArithmeticException.`;
  }
  return `Pops ${String(top)} and ${String(below)} and pushes ${String(below)} ${arithmetic.symbol} ${String(top)} = ${String(arithmetic.apply(below, top))}.`;
}

function explainBranch(context: ExplainContext): string | undefined {
  const { instruction, frame } = context;
  const { mnemonic } = instruction;
  const top = frame.operandStack.at(-1);
  const below = frame.operandStack.at(-2);

  const comparison = COMPARISON[mnemonic];
  if (comparison !== undefined) {
    const comparesPair = mnemonic.startsWith('if_icmp');
    const left = comparesPair ? below : top;
    const right = comparesPair ? top : 0;
    const popped = comparesPair ? 'Pops both values' : 'Pops the top value';
    const premise = `${popped} and compares ${valueText(left)} ${comparison.symbol} ${valueText(right)}`;
    const holds =
      left === undefined || right === undefined ? undefined : comparison.holds(left, right);
    return branchOutcome(context, premise, holds);
  }

  if (mnemonic === 'ifnull' || mnemonic === 'ifnonnull') {
    const premise = `Pops the top reference (${stackText(context, 1)}) and compares it against null`;
    const isNull = top === undefined ? undefined : top === NULL_REFERENCE;
    return branchOutcome(
      context,
      premise,
      isNull === undefined ? undefined : isNull === (mnemonic === 'ifnull'),
    );
  }

  if (mnemonic === 'if_acmpeq' || mnemonic === 'if_acmpne') {
    const wantsSame = mnemonic === 'if_acmpeq';
    const premise =
      `Pops both references and checks whether ${stackText(context, 2)} and ` +
      `${stackText(context, 1)} are ${wantsSame ? 'the same object' : 'different objects'}`;
    const same = sameReference(context);
    return branchOutcome(context, premise, same === undefined ? undefined : same === wantsSame);
  }

  if (mnemonic === 'goto') {
    return `Jumps to pc ${String(instruction.branchTarget ?? 0)}; no value is touched.`;
  }

  if (mnemonic === 'tableswitch' || mnemonic === 'lookupswitch') {
    const [fallback, ...arms] = instruction.switchTargets ?? [];
    if (fallback === undefined) {
      return undefined;
    }
    if (top === undefined) {
      return `Pops an int and jumps to the arm that matches it, or to the default at pc ${String(fallback.target)}.`;
    }
    const arm = arms.find((candidate) => candidate.match === top);
    return arm === undefined
      ? `Pops ${String(top)}, which no arm matches, so execution jumps to the default at pc ${String(fallback.target)}.`
      : `Pops ${String(top)} and jumps to the arm for ${String(top)} at pc ${String(arm.target)}.`;
  }

  return undefined;
}

function branchOutcome(
  context: ExplainContext,
  premise: string,
  taken: boolean | undefined,
): string {
  const target = context.instruction.branchTarget ?? 0;
  if (taken === undefined) {
    return `${premise}; a true comparison jumps to pc ${String(target)}, otherwise execution falls through.`;
  }
  const fallThrough = offsetAfter(context.listing, context.instruction.offset);
  return taken
    ? `${premise}: true, so execution jumps to pc ${String(target)}.`
    : `${premise}: false, so execution falls through to pc ${String(fallThrough ?? context.instruction.offset)}.`;
}

interface HeldValue {
  readonly value: number;
  readonly kind: ValueKind;
}

function heldAt(context: ExplainContext, depth: number): HeldValue | undefined {
  const stack = context.frame.operandStack;
  const index = stack.length - depth;
  const value = stack[index];
  const kind = context.frame.operandKinds[index];
  return value === undefined || kind === undefined ? undefined : { value, kind };
}

function sameReference(context: ExplainContext): boolean | undefined {
  const right = heldAt(context, 1);
  const left = heldAt(context, 2);
  if (right === undefined || left === undefined) {
    return undefined;
  }
  return right.value === left.value && right.kind === left.kind;
}

function explainCall(context: ExplainContext): string | undefined {
  const { instruction, frame } = context;
  const { mnemonic } = instruction;
  const pool = context.classFile.constantPool;

  if (mnemonic === 'ireturn') {
    const popped = valueText(frame.operandStack.at(-1));
    return context.depth > 1
      ? `Pops ${popped}, discards the frame of ${frame.methodName} and pushes the value onto the caller's stack.`
      : `Pops ${popped} and discards the frame of ${frame.methodName}, the only frame there is, so the value becomes the result of the run.`;
  }
  if (mnemonic === 'areturn') {
    const popped = stackText(context, 1);
    return context.depth > 1
      ? `Pops the reference to ${popped}, discards the frame of ${frame.methodName} and pushes the reference onto the caller's stack.`
      : `Pops the reference to ${popped} and discards the frame of ${frame.methodName}, the only frame there is, so the run ends here.`;
  }
  if (mnemonic === 'return') {
    return `Discards the frame of ${frame.methodName} and returns nothing.`;
  }
  if (OPCODE_NOTES[baseMnemonicOf(instruction)]?.frame !== 'call') {
    return undefined;
  }

  const callee = calleeOf(instruction, pool);
  const owner = ownerOf(instruction, pool);
  if (callee === undefined || owner === undefined) {
    return undefined;
  }

  const signature = `${callee.name}${callee.descriptor}`;
  const args = argumentTexts(context, callee.arity);
  const popped = args.length === 0 ? '' : `${args.join(' and ')} and `;
  const receiver = mnemonic === 'invokestatic' ? undefined : stackText(context, callee.arity + 1);

  if (opensFrame(context.classFile, owner, callee.name, callee.descriptor)) {
    const resume = offsetAfter(context.listing, instruction.offset);
    const handover =
      resume === undefined
        ? '. The callee starts at pc 0.'
        : `. The callee starts at pc 0 and ${frame.methodName} resumes at pc ${String(resume)}.`;
    if (receiver !== undefined) {
      return `Pops ${popped}the receiver ${receiver} and calls ${signature}, opening a frame with the receiver in slot 0${handover}`;
    }
    if (args.length === 0) {
      return `Calls ${signature} with no arguments and opens a frame for it${handover}`;
    }
    const slots = args.length === 1 ? 'it in slot 0' : `them in slots 0–${String(args.length - 1)}`;
    return `Pops ${args.join(' and ')} and calls ${signature} with ${slots}${handover}`;
  }

  const target = `${owner}.${signature}`;
  if (owner === OBJECT_CLASS && callee.name === CONSTRUCTOR && receiver !== undefined) {
    return `Pops the reference to ${receiver} and calls ${target}, the constructor every chain of superclasses ends at; it does nothing, so the next instruction runs.`;
  }
  if (EXTERNAL_METHODS.has(memberKey(owner, callee.name, callee.descriptor))) {
    const receiverText = receiver === undefined ? '' : `the receiver ${receiver} and `;
    return `Pops ${popped}${receiverText}calls ${target}, one of the few standard-library methods this machine runs directly, without opening a frame.`;
  }
  if (owner === context.classFile.thisClassName) {
    return `Calls ${target}, which this machine cannot enter: a frame opens only for a method the loaded class declares, with a Code attribute and a descriptor of ints and references, so running it stops the program here.`;
  }
  return `Calls ${target}, which is outside this machine: everything has to resolve inside the loaded class or the standard-library calls it knows, so running it stops the program here.`;
}

const CONSTRUCTOR = '<init>';
const OBJECT_CLASS = 'java/lang/Object';

function argumentTexts(context: ExplainContext, arity: number): readonly string[] {
  const texts: string[] = [];
  for (let depth = arity; depth >= 1; depth--) {
    texts.push(stackText(context, depth));
  }
  return texts;
}

function explainObject(context: ExplainContext): string | undefined {
  const { instruction } = context;
  const { mnemonic } = instruction;
  const pool = context.classFile.constantPool;

  if (mnemonic === 'ldc' || mnemonic === 'ldc_w') {
    const index = constantPoolIndexOf(instruction);
    const entry = index === undefined ? undefined : poolEntry(pool, index);
    if (entry?.tag === ConstantTag.Integer) {
      return `Pushes the int constant ${String(entry.value)} onto the operand stack.`;
    }
    if (entry?.tag === ConstantTag.String) {
      const text = utf8At(pool, entry.stringIndex);
      return text === undefined
        ? undefined
        : `Pushes a reference to the string ${quoted(text)} onto the operand stack.`;
    }
    return index === undefined || entry === undefined
      ? undefined
      : `Pushes constant pool entry #${String(index)}, which is neither an int nor a string, so running it stops the program here.`;
  }

  if (mnemonic === 'getstatic') {
    const member = memberOf(instruction, pool);
    if (member === undefined) {
      return undefined;
    }
    const known = EXTERNAL_FIELDS.get(memberKey(member.owner, member.name, member.descriptor));
    return known === undefined
      ? `Reads the static field ${member.owner}.${member.name}, which is outside this machine: it knows ${knownStaticFields()} and no other static field, so running it stops the program here.`
      : `Pushes a reference to ${known.label} onto the operand stack.`;
  }

  if (mnemonic === 'getfield') {
    const member = memberOf(instruction, pool);
    if (member === undefined) {
      return undefined;
    }
    if (member.owner !== context.classFile.thisClassName) {
      return foreignFieldText(member);
    }
    const held = fieldText(context, 1, member);
    return held === undefined
      ? `Pops an object reference and pushes its field ${member.name}.`
      : `Pops the reference to ${stackText(context, 1)} and pushes its field ${member.name}, currently ${held}.`;
  }

  if (mnemonic === 'putfield') {
    const member = memberOf(instruction, pool);
    if (member === undefined) {
      return undefined;
    }
    return member.owner === context.classFile.thisClassName
      ? `Stores ${stackText(context, 1)} in the field ${member.name} of ${stackText(context, 2)}.`
      : foreignFieldText(member);
  }

  if (mnemonic === 'new') {
    const index = constantPoolIndexOf(instruction);
    const name = index === undefined ? undefined : classNameAt(pool, index);
    if (name === undefined) {
      return undefined;
    }
    return name === context.classFile.thisClassName
      ? `Allocates a ${name} with every field at its default value and pushes the reference. Its constructor has not run yet; that is the invokespecial that follows.`
      : `Allocates a ${name}, which is outside this machine: it allocates instances of ${context.classFile.thisClassName}, the loaded class, and of nothing else, so running it stops the program here.`;
  }

  if (mnemonic === 'athrow') {
    return `Throws ${stackText(context, 1)}: frames are discarded until one has a handler covering this offset whose catch type matches, and the run stops if none does.`;
  }

  return undefined;
}

const LONGEST_SHOWN_LITERAL = 40;

const ESCAPED: Readonly<Record<string, string>> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function quoted(text: string): string {
  const escaped = text.replace(/[\n\r\t]/g, (character) => ESCAPED[character] ?? character);
  return escaped.length <= LONGEST_SHOWN_LITERAL
    ? `"${escaped}"`
    : `"${escaped.slice(0, LONGEST_SHOWN_LITERAL)}…"`;
}

function foreignFieldText(member: Member): string {
  return `Reaches the field ${member.owner}.${member.name}, which is outside this machine: a field resolves only on the loaded class, so running it stops the program here.`;
}

function fieldText(context: ExplainContext, depth: number, member: Member): string | undefined {
  const held = heldAt(context, depth);
  const object = held === undefined ? undefined : context.heap[held.value];
  if (object?.kind !== 'instance' || object.className !== member.owner) {
    return undefined;
  }
  const field = object.fields.find((candidate) => candidate.name === member.name);
  return field === undefined
    ? undefined
    : describeValue(field.kind, field.value, context.heap, context.externals);
}

function explainArray(context: ExplainContext): string | undefined {
  const { instruction, frame } = context;
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
      if (top === undefined) {
        return 'Allocates a zero-filled int array as long as the value on top of the operand stack.';
      }
      return top < 0
        ? `Allocates int[${String(top)}]: a negative length, which stops the run with a NegativeArraySizeException.`
        : `Allocates int[${String(top)}], zero-filled, and pushes a reference to it.`;
    }

    case 'arraylength': {
      const array = arrayAt(context);
      return array === undefined
        ? undefined
        : `Pops the reference to int[${String(array.length)}] and pushes its length, ${String(array.length)}.`;
    }

    case 'iaload': {
      const array = arrayAt(context);
      if (array === undefined || top === undefined) {
        return 'Pops an array reference and an index and pushes the element stored there.';
      }
      const element = array.elements[top];
      return element === undefined
        ? `Reads index ${String(top)} of int[${String(array.length)}]: outside the array, which stops the run with an ArrayIndexOutOfBoundsException.`
        : `Pushes ${String(element)}, the element at index ${String(top)} of int[${String(array.length)}].`;
    }

    case 'iastore': {
      const array = arrayAt(context);
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

function arrayAt(context: ExplainContext): ArrayObject | undefined {
  const depth = OPERAND_ADDRESSING[context.instruction.mnemonic]?.handleDepth;
  const handle = depth === undefined ? undefined : context.frame.operandStack.at(-depth);
  const object = handle === undefined ? undefined : context.heap[handle];
  return object?.kind === 'int-array' ? object : undefined;
}

function stackText(context: ExplainContext, depth: number): string {
  const held = heldAt(context, depth);
  return held === undefined
    ? 'the top value'
    : describeValue(held.kind, held.value, context.heap, context.externals);
}

function valueText(value: number | undefined): string {
  return value === undefined ? 'the top value' : String(value);
}

function offsetAfter(listing: MethodListing | undefined, offset: number): number | undefined {
  const index = listing?.indexByOffset.get(offset);
  return index === undefined ? undefined : listing?.instructions[index + 1]?.offset;
}

function nameOfSlot(frame: StackFrame, slot: number): string {
  return frame.localNames[slot] ?? `slot ${String(slot)}`;
}

function storedName(context: ExplainContext, slot: number): string {
  const { listing } = context;
  const nextOffset = offsetAfter(listing, context.instruction.offset);
  const name =
    listing === undefined || nextOffset === undefined
      ? undefined
      : localNameAt(listing, nextOffset, slot);
  return name ?? nameOfSlot(context.frame, slot);
}

function localNameAt(listing: MethodListing, pc: number, slot: number): string | undefined {
  return listing.localVariables.find(
    (entry) => entry.index === slot && pc >= entry.startPc && pc < entry.startPc + entry.length,
  )?.name;
}

function describeSlot(context: ExplainContext, slot: number): string {
  const { frame } = context;
  const value = frame.locals[slot];
  const kind = frame.localKinds[slot];
  const shown =
    value === undefined || kind === undefined
      ? 'uninitialised'
      : describeValue(kind, value, context.heap, context.externals);
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

function calleeOpensFrame(context: ExplainContext): boolean {
  const member = memberOf(context.instruction, context.classFile.constantPool);
  return (
    member !== undefined &&
    opensFrame(context.classFile, member.owner, member.name, member.descriptor)
  );
}
