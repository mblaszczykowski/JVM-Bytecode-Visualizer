import type { ConstantPool } from '../core/classfile';
import { lookupOpcode } from '../core/disassembler';
import type { Instruction } from '../core/disassembler/types';
import { stackDeltaOf } from '../services/derivations';

export function constantIndexOf(instruction: Instruction): number | undefined {
  return operandTokens(instruction).find((token) => token.constantIndex !== undefined)
    ?.constantIndex;
}

export function formatOperands(instruction: Instruction): string {
  return operandTokens(instruction)
    .map((token) => token.text)
    .join(', ');
}

export interface StackEffect {
  readonly pops: number;
  readonly pushes: number;
}

export function stackEffectOf(
  instruction: Instruction,
  pool: ConstantPool,
): StackEffect | 'varies' | undefined {
  if (lookupOpcode(instruction.opcode)?.kind !== 'supported') {
    return undefined;
  }
  return stackDeltaOf(instruction, pool) ?? 'varies';
}

export function describeStackEffect(
  effect: StackEffect | 'varies' | undefined,
): string | undefined {
  if (effect === undefined) {
    return undefined;
  }
  if (effect === 'varies') {
    return 'stack: varies with the descriptor';
  }
  const parts = [
    ...(effect.pops === 0 ? [] : [`pops ${String(effect.pops)}`]),
    ...(effect.pushes === 0 ? [] : [`pushes ${String(effect.pushes)}`]),
  ];
  return parts.length === 0 ? 'stack: unchanged' : `stack: ${parts.join(', ')}`;
}

export interface OperandToken {
  readonly text: string;
  readonly isReference: boolean;
  readonly constantIndex?: number;
}

export function operandTokens(instruction: Instruction): readonly OperandToken[] {
  if (instruction.branchTarget !== undefined) {
    return [{ text: String(instruction.branchTarget), isReference: true }];
  }

  const specs = lookupOpcode(instruction.opcode)?.operands;

  return instruction.operands.map((operand, position) => {
    const role = specs?.[position]?.role;
    if (role === 'constant-pool-index') {
      return { text: `#${String(operand)}`, isReference: true, constantIndex: operand };
    }
    return { text: String(operand), isReference: role === 'branch-offset' };
  });
}
