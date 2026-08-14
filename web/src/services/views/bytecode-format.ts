import type { ConstantPool } from '../../core/classfile';
import {
  isSupportedOpcode,
  lookupOpcode,
  type Instruction,
  type SwitchCase,
} from '../../core/disassembler';

import { stackDeltaOf, type StackDelta } from './opcode-notes';

export function formatOperands(instruction: Instruction): string {
  return operandTokens(instruction)
    .map((token) => token.text)
    .join(', ');
}

export function stackEffectOf(
  instruction: Instruction,
  pool: ConstantPool,
): StackDelta | 'varies' | undefined {
  if (!isSupportedOpcode(instruction.opcode)) {
    return undefined;
  }
  return stackDeltaOf(instruction, pool) ?? 'varies';
}

export function describeStackEffect(effect: StackDelta | 'varies' | undefined): string | undefined {
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
  const { switchTargets } = instruction;
  if (switchTargets !== undefined) {
    return switchArmsOf(switchTargets);
  }

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

function switchArmsOf(cases: readonly SwitchCase[]): readonly OperandToken[] {
  const matched = cases.filter((arm) => arm.match !== undefined);
  const fallback = cases.find((arm) => arm.match === undefined);

  return [
    ...matched.map((arm) => ({
      text: `${String(arm.match)}: ${String(arm.target)}`,
      isReference: true,
    })),
    ...(fallback === undefined
      ? []
      : [{ text: `default: ${String(fallback.target)}`, isReference: true }]),
  ];
}
