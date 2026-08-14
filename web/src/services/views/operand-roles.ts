import type { ClassFile, ConstantPool } from '../../core/classfile';
import type { Instruction } from '../../core/disassembler';
import type { Snapshot } from '../../core/interpreter';

import { calleeOf, type Callee } from './member-refs';
import { OPERAND_ADDRESSING, stackDeltaOf } from './opcode-notes';
import type { MethodListing } from '../loading/program';

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
    roles[topIndex - taken] = operandRole(instruction, pool, effect.pops, taken);
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

function operandRole(
  instruction: Instruction,
  pool: ConstantPool,
  pops: number,
  taken: number,
): string {
  const { mnemonic } = instruction;
  const named = OPERAND_ADDRESSING[mnemonic]?.roles[taken];
  if (named !== undefined) {
    return named;
  }
  if (mnemonic === 'invokestatic') {
    return argumentRole(calleeOf(instruction, pool), pops - 1 - taken);
  }
  if (mnemonic === 'invokevirtual' || mnemonic === 'invokespecial') {
    return taken === pops - 1
      ? '→ receiver'
      : argumentRole(calleeOf(instruction, pool), pops - 2 - taken);
  }
  if (pops === 2) {
    return taken === 0 ? '→ right' : '→ left';
  }
  return `→ ${mnemonic}`;
}

function argumentRole(callee: Callee | undefined, position: number): string {
  return callee !== undefined && callee.parameterSlots === callee.arity
    ? `→ arg ${String(position)}`
    : '→ argument';
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
