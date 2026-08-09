/**
 * What the Java said, next to what javac emitted.
 *
 * A reader who knows Java and not bytecode can follow a listing instruction by instruction and
 * still miss that three of them are one `for` loop, that an `invokestatic` is the boxing their
 * source never mentions, or that a constructor begins with a call nobody wrote. Every
 * instruction here is already explained on its own; none of them says which *construct* it
 * belongs to, and that is the gap between reading bytecode and understanding it.
 *
 * Recognition is by shape and by constant pool entry, never by guesswork: a construct that
 * cannot be identified from the bytes is not reported. A wrong label is worse than none —
 * someone would learn it.
 *
 * These are javac's habits, not rules of the JVM, so nothing here belongs in `core/`.
 */

import type { ConstantPool } from '../core/classfile';
import type { Instruction } from '../core/disassembler/types';

import { constantPoolIndexOf, resolveConstant } from './derivations';

export interface Construct {
  /** One or two words, shown against the row. */
  readonly label: string;
  /** A sentence for the reader who wants to know why the label is there. */
  readonly detail: string;
}

const BOXES = ['Integer', 'Long', 'Double', 'Float', 'Short', 'Byte', 'Character', 'Boolean'];

/** `java/lang/Integer.valueOf:(I)Ljava/lang/Integer;` and its seven siblings. */
const BOXING = new RegExp(`^java/lang/(${BOXES.join('|')})\\.valueOf:\\(.\\)L`);
/** `java/lang/Integer.intValue:()I` and friends — the same trip back. */
const UNBOXING = new RegExp(`^java/lang/(${BOXES.join('|')})\\.[a-z]+Value:\\(\\)`);

/**
 * Offsets that begin something worth naming. Keyed by offset because the listing is keyed by
 * offset; a construct spanning several instructions is reported on the one that starts it,
 * which is where a reader scanning the listing needs it.
 */
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

  /*
   * Loop heads come last and never displace anything: a row that is both the top of a loop and
   * a boxing call has more to say as the boxing call, and the branch arcs already draw the loop.
   */
  for (const head of backEdges(instructions)) {
    if (!found.has(head)) {
      found.set(head, {
        label: 'loop',
        detail:
          'The top of a loop: something later in the method jumps back here. Nothing in the bytecode says `for` or `while` — a backward jump is all a loop is.',
      });
    }
  }

  return found;
}

/**
 * Targets of every backward branch. A loop is the one construct the bytecode states outright:
 * every loop javac writes ends in a jump to an earlier offset.
 */
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
      detail: `Takes the primitive back out of its wrapper — the reverse of the boxing that put it there, and the call that throws when the reference is null.`,
    };
  }
  if (
    text.startsWith('java/lang/StringBuilder.<init>') ||
    text.includes('makeConcatWithConstants')
  ) {
    return {
      label: 'concat',
      detail:
        'String concatenation. The `+` in the source is not an instruction — the compiler turns it into this, which is why concatenating in a loop costs what it costs.',
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

/**
 * `int[] a = {5, 3, 4}` compiles to an allocation followed by one `dup`/index/value/store per
 * element — which is why a long literal array is a long listing, and worth saying once.
 */
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
