import {
  ConstantTag,
  isClassFileError,
  parseFieldDescriptor,
  parseMethodDescriptor,
  type ClassFile,
  type ConstantPool,
  type JvmReturnType,
} from '../core/classfile';
import { arrayTypeName, lookupOpcode, T_INT, type Instruction } from '../core/disassembler';
import {
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
  type ArrayObject,
  type ExternalValue,
  type HeapObject,
  type Snapshot,
  type StackFrame,
  type ValueKind,
} from '../core/interpreter';

import type { MethodListing } from './program';

export interface EffectPill {
  readonly label: string;
}

export interface NextInstructionSummary {
  readonly effects: readonly EffectPill[];
  readonly explanation: string;
  readonly cpChain?: readonly string[] | undefined;
}

export interface StackDelta {
  readonly pops: number;
  readonly pushes: number;
}

export type PushedKind = 'int' | 'ref';

export interface OpcodeNote {
  readonly help: string;
  readonly pushedKind?: PushedKind | 'descriptor' | 'stack-top';
  readonly frame?: 'call' | 'return';
  readonly varies?: (instruction: Instruction, pool: ConstantPool) => StackDelta | undefined;
}

interface ExplainContext {
  readonly instruction: Instruction;
  readonly frame: StackFrame;
  readonly heap: readonly HeapObject[];
  readonly externals: readonly ExternalValue[];
  readonly listing: MethodListing | undefined;
  readonly classFile: ClassFile;
}

const NO_HEAP: readonly HeapObject[] = [];
const NO_EXTERNALS: readonly ExternalValue[] = [];

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
    heap: snapshot.heap ?? NO_HEAP,
    externals: snapshot.externals ?? NO_EXTERNALS,
    listing,
    classFile,
  };

  return {
    effects: effectsOf(context),
    explanation: explain(context),
    cpChain: resolveOperandConstant(instruction, classFile.constantPool)?.chain,
  };
}

export function describeValue(
  kind: ValueKind | undefined,
  value: number,
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
): string {
  switch (kind) {
    case 'ref': {
      const object = heap[value];
      return object === undefined ? 'null' : `${objectName(object)}@${String(value)}`;
    }
    case 'external':
      return externals[value]?.label ?? 'an unknown object';
    case 'int':
    case undefined:
      return String(value);
  }
}

function objectName(object: HeapObject): string {
  return object.kind === 'int-array' ? `int[${String(object.length)}]` : object.className;
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
  const named = OPERAND_ADDRESSING[mnemonic]?.roles[taken];
  if (named !== undefined) {
    return named;
  }
  if (mnemonic === 'invokestatic') {
    return `→ arg ${String(pops - 1 - taken)}`;
  }
  if (mnemonic === 'invokevirtual' || mnemonic === 'invokespecial') {
    return taken === pops - 1 ? '→ receiver' : `→ arg ${String(pops - 2 - taken)}`;
  }
  if (pops === 2) {
    return taken === 0 ? '→ right' : '→ left';
  }
  return `→ ${mnemonic}`;
}

export interface OperandAddressing {
  readonly roles: readonly string[];
  readonly handleDepth?: number;
  readonly indexDepth?: number;
  readonly access?: 'read' | 'write';
}

export const OPERAND_ADDRESSING: Readonly<Record<string, OperandAddressing>> = {
  iaload: { roles: ['→ index', '→ array'], handleDepth: 2, indexDepth: 1, access: 'read' },
  iastore: {
    roles: ['→ value', '→ index', '→ array'],
    handleDepth: 3,
    indexDepth: 2,
    access: 'write',
  },
  arraylength: { roles: ['→ array'], handleDepth: 1, access: 'read' },
  newarray: { roles: ['→ length'] },
  getfield: { roles: ['→ object'], handleDepth: 1, access: 'read' },
  putfield: { roles: ['→ value', '→ object'], handleDepth: 2, access: 'write' },
  athrow: { roles: ['→ thrown'] },
  areturn: { roles: ['→ returned'] },
  ifnull: { roles: ['→ tested'] },
  ifnonnull: { roles: ['→ tested'] },
  tableswitch: { roles: ['→ key'] },
  lookupswitch: { roles: ['→ key'] },
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
    case ConstantTag.Fieldref:
    case ConstantTag.InterfaceMethodref: {
      const owner = className(pool, entry.classIndex);
      const member = nameAndType(pool, entry.nameAndTypeIndex);
      if (owner === undefined || member === undefined) {
        return undefined;
      }
      const text = `${owner}.${member.name}:${member.descriptor}`;
      return link(text, `// ${MEMBER_KINDS.get(entry.tag) ?? tagName} ${text}`);
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
    case ConstantTag.MethodHandle: {
      const kind = REFERENCE_KINDS.get(entry.referenceKind);
      const referenced = resolveConstant(pool, entry.referenceIndex);
      if (kind === undefined || referenced === undefined) {
        return undefined;
      }
      const text = `${kind} ${referenced.text}`;
      return link(text, `// MethodHandle ${text}`);
    }
    case ConstantTag.MethodType: {
      const descriptor = utf8(pool, entry.descriptorIndex);
      return descriptor === undefined ? undefined : link(descriptor, `// MethodType ${descriptor}`);
    }
    case ConstantTag.Dynamic:
    case ConstantTag.InvokeDynamic: {
      const member = nameAndType(pool, entry.nameAndTypeIndex);
      if (member === undefined) {
        return undefined;
      }
      const text = `#${String(entry.bootstrapMethodAttrIndex)}:${member.name}:${member.descriptor}`;
      return link(text, `// ${tagName} ${text}`);
    }
    case ConstantTag.Module:
    case ConstantTag.Package: {
      const name = utf8(pool, entry.nameIndex);
      return name === undefined ? undefined : link(name, `// ${tagName} ${name}`);
    }
    case ConstantTag.Float: {
      const text = `${decimalText(entry.value)}f`;
      return link(text, `// float ${text}`);
    }
    case ConstantTag.Double: {
      const text = `${decimalText(entry.value)}d`;
      return link(text, `// double ${text}`);
    }
    case ConstantTag.Long: {
      const text = `${entry.value.toString()}l`;
      return link(text, `// long ${text}`);
    }
  }
}

function decimalText(value: number): string {
  if (!Number.isInteger(value)) {
    return String(value);
  }
  return Object.is(value, -0) ? '-0.0' : `${String(value)}.0`;
}

const MEMBER_KINDS: ReadonlyMap<number, string> = new Map([
  [ConstantTag.Methodref, 'Method'],
  [ConstantTag.Fieldref, 'Field'],
  [ConstantTag.InterfaceMethodref, 'InterfaceMethod'],
]);

const REFERENCE_KINDS: ReadonlyMap<number, string> = new Map([
  [1, 'REF_getField'],
  [2, 'REF_getStatic'],
  [3, 'REF_putField'],
  [4, 'REF_putStatic'],
  [5, 'REF_invokeVirtual'],
  [6, 'REF_invokeStatic'],
  [7, 'REF_invokeSpecial'],
  [8, 'REF_newInvokeSpecial'],
  [9, 'REF_invokeInterface'],
]);

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

export function stackDeltaOf(instruction: Instruction, pool: ConstantPool): StackDelta | undefined {
  const info = lookupOpcode(instruction.opcode);
  if (info?.kind !== 'supported') {
    return undefined;
  }
  if (info.stackEffect.kind === 'fixed') {
    return { pops: info.stackEffect.pops, pushes: info.stackEffect.pushes };
  }
  return OPCODE_NOTES[instruction.mnemonic]?.varies?.(instruction, pool);
}

function effectsOf(context: ExplainContext): readonly EffectPill[] {
  const { instruction } = context;
  if (lookupOpcode(instruction.opcode)?.kind !== 'supported') {
    return [];
  }
  const delta = stackDeltaOf(instruction, context.classFile.constantPool);
  if (delta === undefined) {
    return [];
  }

  const note = OPCODE_NOTES[instruction.mnemonic];
  const pushed = pushedKindOf(context);
  if (note?.frame === 'return') {
    return [...popPills(delta.pops), { label: 'pop frame' }, ...pushPills(delta.pops, pushed)];
  }
  if (note?.frame === 'call' && calleeRunsInThisClass(context)) {
    return [...popPills(delta.pops), { label: 'push frame' }];
  }
  return [...popPills(delta.pops), ...pushPills(delta.pushes, pushed)];
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

function pushedKindOf(context: ExplainContext): PushedKind {
  const pushed = OPCODE_NOTES[context.instruction.mnemonic]?.pushedKind;
  if (pushed === 'descriptor') {
    return descriptorKindOf(context.instruction, context.classFile.constantPool);
  }
  if (pushed === 'stack-top') {
    return context.frame.operandKinds?.at(-1) === 'int' ? 'int' : 'ref';
  }
  return pushed ?? 'int';
}

function descriptorKindOf(instruction: Instruction, pool: ConstantPool): PushedKind {
  const index = constantPoolIndexOf(instruction);
  const entry = index === undefined ? undefined : (pool[index] ?? undefined);
  if (entry?.tag === ConstantTag.String) {
    return 'ref';
  }
  if (entry?.tag === ConstantTag.Methodref) {
    return calleeOf(instruction, pool)?.returnsReference === true ? 'ref' : 'int';
  }
  if (entry?.tag === ConstantTag.Fieldref) {
    const member = nameAndType(pool, entry.nameAndTypeIndex);
    return member !== undefined && isReferenceDescriptor(member.descriptor) ? 'ref' : 'int';
  }
  return 'int';
}

function isReferenceDescriptor(descriptor: string): boolean {
  return descriptor.startsWith('L') || descriptor.startsWith('[');
}

function fixedDelta(pops: number, pushes: number): () => StackDelta {
  const delta: StackDelta = { pops, pushes };
  return () => delta;
}

function callDelta(
  receivers: 0 | 1,
): (instruction: Instruction, pool: ConstantPool) => StackDelta | undefined {
  return (instruction, pool) => {
    const callee = calleeOf(instruction, pool);
    return callee === undefined
      ? undefined
      : { pops: callee.parameterSlots + receivers, pushes: callee.returnSlots };
  };
}

function fieldDelta(
  objectRefs: 0 | 1,
  direction: 'read' | 'write',
): (instruction: Instruction, pool: ConstantPool) => StackDelta | undefined {
  return (instruction, pool) => {
    const member = memberOf(instruction, pool);
    const slots = member === undefined ? undefined : fieldSlots(member.descriptor);
    if (slots === undefined) {
      return undefined;
    }
    return direction === 'read'
      ? { pops: objectRefs, pushes: slots }
      : { pops: objectRefs + slots, pushes: 0 };
  };
}

function fieldSlots(descriptor: string): number | undefined {
  try {
    return slotsOf(parseFieldDescriptor(descriptor));
  } catch (error) {
    if (!isClassFileError(error)) {
      throw error;
    }
    return undefined;
  }
}

function slotsOf(type: JvmReturnType): number {
  if (type.kind === 'void') {
    return 0;
  }
  return type.kind === 'primitive' && (type.name === 'long' || type.name === 'double') ? 2 : 1;
}

const NOTES: readonly (readonly [string, OpcodeNote])[] = [
  ['nop', { help: 'Does nothing.' }],
  ['aconst_null', { help: 'Pushes the null reference onto the operand stack.', pushedKind: 'ref' }],
  ['bipush', { help: 'Pushes a one-byte signed constant, widened to an int.' }],
  ['sipush', { help: 'Pushes a two-byte signed constant, widened to an int.' }],
  [
    'ldc',
    {
      help:
        'Pushes the constant at a one-byte constant pool index. This machine pushes int ' +
        'constants and string literals; any other kind of entry stops the run.',
      pushedKind: 'descriptor',
    },
  ],
  [
    'ldc_w',
    {
      help:
        'Pushes the constant at a two-byte constant pool index, for pools with more than 255 ' +
        'entries. The subset it can push is the same as ldc.',
      pushedKind: 'descriptor',
    },
  ],
  [
    'iload',
    { help: 'Pushes the local variable slot named by the operand onto the operand stack.' },
  ],
  [
    'istore',
    {
      help: 'Pops the top of the operand stack into the local variable slot named by the operand.',
    },
  ],
  [
    'aload',
    {
      help: 'Pushes the reference held by the local variable slot named by the operand.',
      pushedKind: 'ref',
    },
  ],
  [
    'astore',
    {
      help: 'Pops a reference off the operand stack into the local variable slot named by the operand.',
    },
  ],
  [
    'newarray',
    {
      help:
        'Pops a length and allocates a zero-filled array of the primitive type named by the ' +
        'operand, pushing the reference to it.',
      pushedKind: 'ref',
    },
  ],
  ['arraylength', { help: 'Pops an array reference and pushes the length of the array.' }],
  [
    'iaload',
    { help: 'Pops an array reference and an index and pushes the int stored at that index.' },
  ],
  [
    'iastore',
    { help: 'Pops an array reference, an index and an int, and stores the int at that index.' },
  ],
  [
    'iinc',
    { help: 'Adds a constant to a local variable in place, without touching the operand stack.' },
  ],
  ['pop', { help: 'Discards the top value of the operand stack.' }],
  [
    'pop2',
    {
      help:
        'Discards the top two values of the operand stack. On a real JVM the same opcode ' +
        'discards a single long or double instead, and this subset has neither.',
    },
  ],
  ['dup', { help: 'Duplicates the top value of the operand stack.', pushedKind: 'stack-top' }],
  [
    'dup_x1',
    {
      help: 'Duplicates the top value and inserts the copy below the value that was under it.',
      pushedKind: 'stack-top',
    },
  ],
  [
    'dup2',
    { help: 'Duplicates the top two values, keeping their order.', pushedKind: 'stack-top' },
  ],
  [
    'dup2_x1',
    {
      help: 'Duplicates the top two values and inserts the copies below the third value.',
      pushedKind: 'stack-top',
    },
  ],
  ['swap', { help: 'Exchanges the top two values of the operand stack.', pushedKind: 'stack-top' }],
  ['iadd', { help: 'Pops two ints and pushes their sum, wrapping around on overflow.' }],
  ['isub', { help: 'Pops two ints and pushes the lower minus the upper.' }],
  ['imul', { help: 'Pops two ints and pushes their product, wrapping around on overflow.' }],
  [
    'idiv',
    { help: 'Pops two ints and pushes the quotient, truncated towards zero; zero divisor throws.' },
  ],
  ['irem', { help: 'Pops two ints and pushes the remainder of the division.' }],
  ['ineg', { help: 'Pops an int and pushes its negation.' }],
  [
    'ishl',
    {
      help: 'Pops a distance and an int and pushes the int shifted left by the low five bits of the distance.',
    },
  ],
  [
    'ishr',
    {
      help: 'Pops a distance and an int and pushes the int shifted right, keeping its sign bit.',
    },
  ],
  [
    'iushr',
    {
      help: 'Pops a distance and an int and pushes the int shifted right, filling on the left with zeros.',
    },
  ],
  ['iand', { help: 'Pops two ints and pushes their bitwise and.' }],
  ['ior', { help: 'Pops two ints and pushes their bitwise or.' }],
  ['ixor', { help: 'Pops two ints and pushes their bitwise exclusive or.' }],
  ['i2b', { help: 'Pops an int and pushes its low eight bits, sign extended: the cast to byte.' }],
  [
    'i2c',
    { help: 'Pops an int and pushes its low sixteen bits without a sign: the cast to char.' },
  ],
  [
    'i2s',
    { help: 'Pops an int and pushes its low sixteen bits, sign extended: the cast to short.' },
  ],
  ['if_icmpeq', { help: 'Pops two ints and branches when they are equal.' }],
  ['if_icmpne', { help: 'Pops two ints and branches when they differ.' }],
  ['if_icmplt', { help: 'Pops two ints and branches when the lower one is smaller.' }],
  ['if_icmpge', { help: 'Pops two ints and branches when the lower one is greater or equal.' }],
  ['if_icmpgt', { help: 'Pops two ints and branches when the lower one is greater.' }],
  ['if_icmple', { help: 'Pops two ints and branches when the lower one is smaller or equal.' }],
  ['ifeq', { help: 'Pops an int and branches when it is zero.' }],
  ['ifne', { help: 'Pops an int and branches when it is not zero.' }],
  ['iflt', { help: 'Pops an int and branches when it is negative.' }],
  ['ifge', { help: 'Pops an int and branches when it is zero or positive.' }],
  ['ifgt', { help: 'Pops an int and branches when it is positive.' }],
  ['ifle', { help: 'Pops an int and branches when it is zero or negative.' }],
  ['if_acmpeq', { help: 'Pops two references and branches when they point at the same object.' }],
  ['if_acmpne', { help: 'Pops two references and branches when they point at different objects.' }],
  ['ifnull', { help: 'Pops a reference and branches when it is null.' }],
  ['ifnonnull', { help: 'Pops a reference and branches when it is not null.' }],
  ['goto', { help: 'Jumps to the target offset unconditionally.' }],
  [
    'tableswitch',
    {
      help:
        'Pops an int and jumps through a table of consecutive case values, or to the default ' +
        'target when the value falls outside the range the table covers.',
    },
  ],
  [
    'lookupswitch',
    {
      help:
        'Pops an int and jumps through a sorted table of case values, or to the default target ' +
        'when none of them matches.',
    },
  ],
  [
    'ireturn',
    {
      help: "Pops an int, discards this frame and pushes the value onto the caller's stack.",
      frame: 'return',
      varies: fixedDelta(1, 0),
    },
  ],
  [
    'areturn',
    {
      help: "Pops a reference, discards this frame and pushes it onto the caller's stack.",
      pushedKind: 'ref',
      frame: 'return',
      varies: fixedDelta(1, 0),
    },
  ],
  [
    'return',
    {
      help: 'Discards this frame and returns no value.',
      frame: 'return',
      varies: fixedDelta(0, 0),
    },
  ],
  [
    'getstatic',
    {
      help:
        'Reads the static field named by the constant pool and pushes its value. This machine ' +
        'knows System.out and no other static field.',
      pushedKind: 'descriptor',
      varies: fieldDelta(0, 'read'),
    },
  ],
  [
    'getfield',
    {
      help: 'Pops an object reference and pushes the value of the field named by the constant pool.',
      pushedKind: 'descriptor',
      varies: fieldDelta(1, 'read'),
    },
  ],
  [
    'putfield',
    {
      help:
        'Pops a value and an object reference and stores the value in the field named by the ' +
        'constant pool.',
      varies: fieldDelta(1, 'write'),
    },
  ],
  [
    'invokevirtual',
    {
      help:
        'Pops the receiver and the arguments and calls an instance method, chosen at run time ' +
        'by the class of the receiver. A method of the loaded class opens a frame; the few ' +
        'standard-library methods this machine knows run without one.',
      pushedKind: 'descriptor',
      frame: 'call',
      varies: callDelta(1),
    },
  ],
  [
    'invokespecial',
    {
      help:
        'Calls a constructor, a private method or a superclass method. The target is fixed when ' +
        'the class is compiled rather than chosen by the class of the receiver.',
      pushedKind: 'descriptor',
      frame: 'call',
      varies: callDelta(1),
    },
  ],
  [
    'invokestatic',
    {
      help:
        'Resolves a static method through the constant pool, pops its arguments into the new ' +
        "frame's slots and starts executing it.",
      pushedKind: 'descriptor',
      frame: 'call',
      varies: callDelta(0),
    },
  ],
  [
    'new',
    {
      help:
        'Allocates an instance of the class named by the constant pool, with every field at its ' +
        'default value, and pushes the reference. The constructor is the invokespecial that ' +
        'follows.',
      pushedKind: 'ref',
    },
  ],
  [
    'athrow',
    {
      help:
        'Pops a throwable and throws it. Frames are discarded until one has a handler covering ' +
        'the throw whose catch type matches, and the run stops if none does.',
      varies: fixedDelta(1, 0),
    },
  ],
];

function slotNotes(): readonly (readonly [string, OpcodeNote])[] {
  return [0, 1, 2, 3].flatMap((slot) => {
    const number = String(slot);
    return [
      [
        `iload_${number}`,
        { help: `Pushes local variable slot ${number} onto the operand stack.` },
      ] as const,
      [
        `istore_${number}`,
        { help: `Pops the top of the operand stack into local variable slot ${number}.` },
      ] as const,
      [
        `aload_${number}`,
        {
          help: `Pushes the reference in local variable slot ${number} onto the operand stack.`,
          pushedKind: 'ref',
        },
      ] as const,
      [
        `astore_${number}`,
        { help: `Pops the top of the operand stack into local variable slot ${number}.` },
      ] as const,
    ];
  });
}

function constantNotes(): readonly (readonly [string, OpcodeNote])[] {
  return [-1, 0, 1, 2, 3, 4, 5].map((value) => {
    const shown = value < 0 ? '−1' : String(value);
    return [
      `iconst_${value < 0 ? 'm1' : String(value)}`,
      { help: `Pushes the int constant ${shown} onto the operand stack.` },
    ] as const;
  });
}

export const OPCODE_NOTES: Readonly<Record<string, OpcodeNote>> = Object.fromEntries([
  ...NOTES,
  ...slotNotes(),
  ...constantNotes(),
]);

export function explainMnemonic(mnemonic: string): string | undefined {
  return OPCODE_NOTES[mnemonic]?.help;
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
  const { mnemonic } = context.instruction;

  if (lookupOpcode(context.instruction.opcode)?.kind !== 'supported') {
    return `${mnemonic} is outside the supported instruction subset; running it stops the program here.`;
  }

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
  const { mnemonic } = instruction;

  if (mnemonic.startsWith('iload')) {
    const slot = slotOf(instruction);
    return `Pushes local ${String(slot)} (${describeSlot(context, slot)}) onto the operand stack.`;
  }

  if (mnemonic.startsWith('aload')) {
    const slot = slotOf(instruction);
    return `Pushes the reference in local ${String(slot)} (${describeSlot(context, slot)}) onto the operand stack.`;
  }

  if (mnemonic === 'aconst_null') {
    return 'Pushes the null reference onto the operand stack.';
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
    return `Pops the reference to ${stackText(context, 1, 'ref')} into local slot ${String(slot)} (${storedName(context, slot)}).`;
  }

  if (mnemonic === 'iinc') {
    const slot = instruction.operands[0] ?? 0;
    const delta = instruction.operands[1] ?? 0;
    const verb = delta < 0 ? 'Subtracts' : 'Adds';
    return `${verb} ${String(Math.abs(delta))} to local ${String(slot)} (${describeSlot(context, slot)}) in place, without touching the operand stack.`;
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
    case 'dup2':
      return `Duplicates ${below} and ${top}, leaving both pairs on the operand stack.`;
    case 'dup2_x1':
      return `Duplicates ${below} and ${top} and inserts the copies below ${stackText(context, 3)}.`;
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
    return `Pops ${String(below)} and ${String(top)}: dividing by zero, which stops the run with an ArithmeticException.`;
  }
  return `Pops ${String(top)} and ${String(below)} and pushes ${String(below)} ${arithmetic.symbol} ${String(top)} = ${String(arithmetic.apply(below, top))}.`;
}

function explainBranch(context: ExplainContext): string | undefined {
  const { instruction, frame } = context;
  const { mnemonic } = instruction;
  const top = frame.operandStack.at(-1);
  const below = frame.operandStack.at(-2);

  const operator = COMPARISON[mnemonic];
  if (operator !== undefined) {
    const comparesPair = mnemonic.startsWith('if_icmp');
    const left = comparesPair ? below : top;
    const right = comparesPair ? top : 0;
    const popped = comparesPair ? 'Pops both values' : 'Pops the top value';
    const premise = `${popped} and compares ${valueText(left)} ${operator} ${valueText(right)}`;
    return branchOutcome(context, premise, comparisonHolds(mnemonic, left, right));
  }

  if (mnemonic === 'ifnull' || mnemonic === 'ifnonnull') {
    const premise = `Pops the top reference (${stackText(context, 1, 'ref')}) and compares it against null`;
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
      `Pops both references and checks whether ${stackText(context, 2, 'ref')} and ` +
      `${stackText(context, 1, 'ref')} are ${wantsSame ? 'the same object' : 'different objects'}`;
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

interface HeldReference {
  readonly value: number | undefined;
  readonly kind: ValueKind | undefined;
}

function referenceAt(context: ExplainContext, depth: number): HeldReference {
  const stack = context.frame.operandStack;
  const index = stack.length - depth;
  return { value: stack[index], kind: context.frame.operandKinds?.[index] };
}

function sameReference(context: ExplainContext): boolean | undefined {
  const right = referenceAt(context, 1);
  const left = referenceAt(context, 2);
  if (right.value === undefined || left.value === undefined) {
    return undefined;
  }
  return right.value === left.value && right.kind === left.kind;
}

function explainCall(context: ExplainContext): string | undefined {
  const { instruction, frame } = context;
  const { mnemonic } = instruction;
  const pool = context.classFile.constantPool;

  if (mnemonic === 'ireturn') {
    return `Pops ${valueText(frame.operandStack.at(-1))}, discards the frame of ${frame.methodName} and pushes the value onto the caller's stack.`;
  }
  if (mnemonic === 'areturn') {
    return `Pops the reference to ${stackText(context, 1, 'ref')}, discards the frame of ${frame.methodName} and pushes the reference onto the caller's stack.`;
  }
  if (mnemonic === 'return') {
    return `Discards the frame of ${frame.methodName} and returns nothing.`;
  }
  if (OPCODE_NOTES[mnemonic]?.frame !== 'call') {
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
  const receiver =
    mnemonic === 'invokestatic' ? undefined : stackText(context, callee.arity + 1, 'ref');

  if (owner === context.classFile.thisClassName) {
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
  if (callee.name === CONSTRUCTOR && receiver !== undefined) {
    return `Pops the reference to ${receiver} and calls ${target}, the constructor every chain of superclasses ends at; it does nothing, so the next instruction runs.`;
  }
  if (EXTERNAL_METHODS.has(memberKey(owner, callee.name, callee.descriptor))) {
    const receiverText = receiver === undefined ? '' : `the receiver ${receiver} and `;
    return `Pops ${popped}${receiverText}calls ${target}, one of the few standard-library methods this machine runs directly, without opening a frame.`;
  }
  return `Calls ${target}, which is outside this machine: everything has to resolve inside the loaded class or the standard-library calls it knows, so running it stops the program here.`;
}

const CONSTRUCTOR = '<init>';

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
    const entry = index === undefined ? undefined : (pool[index] ?? undefined);
    if (entry?.tag === ConstantTag.Integer) {
      return `Pushes the int constant ${String(entry.value)} onto the operand stack.`;
    }
    if (entry?.tag === ConstantTag.String) {
      const text = utf8(pool, entry.stringIndex);
      return `Pushes a reference to the string "${text ?? ''}" onto the operand stack.`;
    }
    return index === undefined || entry === undefined
      ? undefined
      : `Pushes constant pool entry #${String(index)}, which is neither an int nor a string, so running it stops the program here.`;
  }

  if (mnemonic === 'getstatic') {
    const member = memberOf(instruction, pool);
    return member === undefined
      ? undefined
      : `Pushes the value of the static field ${member.owner}.${member.name}. This machine knows System.out and no other static field.`;
  }

  if (mnemonic === 'getfield') {
    const member = memberOf(instruction, pool);
    if (member === undefined) {
      return undefined;
    }
    const held = fieldText(context, 1, member.name);
    return held === undefined
      ? `Pops an object reference and pushes its field ${member.name}.`
      : `Pops the reference to ${stackText(context, 1, 'ref')} and pushes its field ${member.name}, currently ${held}.`;
  }

  if (mnemonic === 'putfield') {
    const member = memberOf(instruction, pool);
    return member === undefined
      ? undefined
      : `Stores ${stackText(context, 1)} in the field ${member.name} of ${stackText(context, 2, 'ref')}.`;
  }

  if (mnemonic === 'new') {
    const index = constantPoolIndexOf(instruction);
    const name = index === undefined ? undefined : className(pool, index);
    return name === undefined
      ? undefined
      : `Allocates a ${name} with every field at its default value and pushes the reference. Its constructor has not run yet; that is the invokespecial that follows.`;
  }

  if (mnemonic === 'athrow') {
    return `Throws ${stackText(context, 1, 'external')}: frames are discarded until one has a handler covering this offset whose catch type matches, and the run stops if none does.`;
  }

  return undefined;
}

function fieldText(context: ExplainContext, depth: number, name: string): string | undefined {
  const held = referenceAt(context, depth);
  const object = held.value === undefined ? undefined : context.heap[held.value];
  if (object?.kind !== 'instance') {
    return undefined;
  }
  const field = object.fields.find((candidate) => candidate.name === name);
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
      return top === undefined
        ? 'Allocates a zero-filled int array as long as the value on top of the operand stack.'
        : `Allocates int[${String(top)}], zero-filled, and pushes a reference to it.`;
    }

    case 'arraylength': {
      const array = arrayAt(context);
      return array === undefined
        ? 'Pops an array reference and pushes the length of the array.'
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

function stackText(context: ExplainContext, depth: number, assumed?: ValueKind): string {
  const held = referenceAt(context, depth);
  return held.value === undefined
    ? 'the top value'
    : describeValue(held.kind ?? assumed, held.value, context.heap, context.externals);
}

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
  const shown =
    value === undefined
      ? 'uninitialised'
      : describeValue(frame.localKinds?.[slot], value, context.heap, context.externals);
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
  readonly parameterSlots: number;
  readonly returnSlots: number;
  readonly returnsReference: boolean;
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
  return { name: member.name, descriptor: member.descriptor, ...parsed };
}

function calleeRunsInThisClass(context: ExplainContext): boolean {
  return (
    ownerOf(context.instruction, context.classFile.constantPool) === context.classFile.thisClassName
  );
}

interface Member {
  readonly owner: string;
  readonly name: string;
  readonly descriptor: string;
}

function memberOf(instruction: Instruction, pool: ConstantPool): Member | undefined {
  const index = constantPoolIndexOf(instruction);
  const entry = index === undefined ? undefined : (pool[index] ?? undefined);
  if (entry?.tag !== ConstantTag.Fieldref && entry?.tag !== ConstantTag.Methodref) {
    return undefined;
  }
  const owner = className(pool, entry.classIndex);
  const member = nameAndType(pool, entry.nameAndTypeIndex);
  return owner === undefined || member === undefined
    ? undefined
    : { owner, name: member.name, descriptor: member.descriptor };
}

function ownerOf(instruction: Instruction, pool: ConstantPool): string | undefined {
  return memberOf(instruction, pool)?.owner;
}

function parseDescriptor(descriptor: string):
  | {
      readonly arity: number;
      readonly parameterSlots: number;
      readonly returnSlots: number;
      readonly returnsReference: boolean;
    }
  | undefined {
  try {
    const parsed = parseMethodDescriptor(descriptor);
    return {
      arity: parsed.params.length,
      parameterSlots: parsed.params.reduce((total, type) => total + slotsOf(type), 0),
      returnSlots: slotsOf(parsed.returnType),
      returnsReference: parsed.returnType.kind === 'class' || parsed.returnType.kind === 'array',
    };
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
  const start = listing.indexByOffset.get(fromOffset);
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
          : listing.indexByOffset.get(instruction.branchTarget);
      if (target === undefined) {
        return undefined;
      }
      index = target - 1;
    }
  }
  return undefined;
}
