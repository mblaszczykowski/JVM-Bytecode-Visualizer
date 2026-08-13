import { isClassFileError, parseFieldDescriptor, type ConstantPool } from '../core/classfile';
import { lookupOpcode, type Instruction } from '../core/disassembler';

import { calleeOf, memberOf, slotsOf } from './member-refs';

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

export function baseMnemonicOf(instruction: Instruction): string {
  return lookupOpcode(instruction.opcode)?.mnemonic ?? instruction.mnemonic;
}

export function stackDeltaOf(instruction: Instruction, pool: ConstantPool): StackDelta | undefined {
  const info = lookupOpcode(instruction.opcode);
  if (info?.kind !== 'supported') {
    return undefined;
  }
  if (info.stackEffect.kind === 'fixed') {
    return { pops: info.stackEffect.pops, pushes: info.stackEffect.pushes };
  }
  return OPCODE_NOTES[baseMnemonicOf(instruction)]?.varies?.(instruction, pool);
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
    'dup_x2',
    {
      help: 'Duplicates the top value and inserts the copy below the two values under it.',
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
  [
    'dup2_x2',
    {
      help: 'Duplicates the top two values and inserts the copies below the two under them.',
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
