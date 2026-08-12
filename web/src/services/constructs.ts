import type { ConstantPool } from '../core/classfile';
import type { Instruction } from '../core/disassembler';

import { constantPoolIndexOf, resolveConstant } from './derivations';

export interface Construct {
  readonly label: string;
  readonly detail: string;
}

const BOXES = ['Integer', 'Long', 'Double', 'Float', 'Short', 'Byte', 'Character', 'Boolean'];

const BOXING = new RegExp(`^java/lang/(${BOXES.join('|')})\\.valueOf:\\(.\\)L`);
const UNBOXING = new RegExp(`^java/lang/(${BOXES.join('|')})\\.[a-z]+Value:\\(\\)`);

export function constructsFor(
  instructions: readonly Instruction[],
  pool: ConstantPool,
  methodName: string,
): ReadonlyMap<number, Construct> {
  const found = new Map<number, Construct>();

  for (const [index, instruction] of instructions.entries()) {
    const construct =
      fromConstantPool(instruction, pool, methodName, index) ??
      arrayInitialiser(instruction, instructions, index);
    if (construct !== undefined && !found.has(instruction.offset)) {
      found.set(instruction.offset, construct);
    }
  }

  for (const head of backEdges(instructions)) {
    if (!found.has(head)) {
      found.set(head, {
        label: 'loop',
        detail:
          'The top of a loop: something later in the method jumps back here. Nothing in the bytecode says `for` or `while`; a loop is just a backward jump.',
      });
    }
  }

  return found;
}

function backEdges(instructions: readonly Instruction[]): ReadonlySet<number> {
  const heads = new Set<number>();
  const offsets = new Set(instructions.map((instruction) => instruction.offset));
  for (const instruction of instructions) {
    const target = instruction.branchTarget;
    if (target !== undefined && target < instruction.offset && offsets.has(target)) {
      heads.add(target);
    }
  }
  return heads;
}

function fromConstantPool(
  instruction: Instruction,
  pool: ConstantPool,
  methodName: string,
  index: number,
): Construct | undefined {
  const poolIndex = constantPoolIndexOf(instruction);
  if (poolIndex === undefined) {
    return undefined;
  }
  const text = resolveConstant(pool, poolIndex)?.text;
  if (text === undefined) {
    return undefined;
  }

  if (BOXING.test(text)) {
    return {
      label: 'boxing',
      detail: `The source has a primitive here; ${text.split(':')[0] ?? text} wraps it in an object because that is what the surrounding code needs.`,
    };
  }
  if (UNBOXING.test(text)) {
    return {
      label: 'unboxing',
      detail: `Takes the primitive back out of its wrapper, reversing the boxing that put it there. This is the call that throws when the reference is null.`,
    };
  }
  if (
    text.startsWith('java/lang/StringBuilder.<init>') ||
    text.includes('makeConcatWithConstants')
  ) {
    return {
      label: 'concat',
      detail:
        'String concatenation. The `+` in the source is not an instruction; the compiler turns it into this, which is why concatenating in a loop is expensive.',
    };
  }
  if (text.startsWith('java/util/Objects.requireNonNull')) {
    return {
      label: 'null check',
      detail: 'A null check the compiler inserted; nothing in the source asked for it.',
    };
  }
  if (
    methodName === '<init>' &&
    instruction.mnemonic === 'invokespecial' &&
    text.endsWith('.<init>:()V') &&
    index <= 1
  ) {
    return {
      label: 'super()',
      detail: `Every constructor begins by calling its superclass constructor (JVMS §2.9.1). ${text.split('.')[0] ?? 'The superclass'} was never mentioned in the source.`,
    };
  }
  if (text.includes('$assertionsDisabled')) {
    return {
      label: 'assert',
      detail: 'An `assert` statement, compiled behind the flag that decides whether it runs.',
    };
  }
  return undefined;
}

function arrayInitialiser(
  instruction: Instruction,
  instructions: readonly Instruction[],
  index: number,
): Construct | undefined {
  if (instruction.mnemonic !== 'newarray' && instruction.mnemonic !== 'anewarray') {
    return undefined;
  }
  if (instructions[index + 1]?.mnemonic !== 'dup') {
    return undefined;
  }
  return {
    label: 'array literal',
    detail:
      'An array written out in the source. The allocation is one instruction; every element after it is a separate store.',
  };
}
