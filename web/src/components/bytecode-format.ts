import type { Instruction } from '../core/disassembler/types';

/**
 * Mnemonics whose operand is a constant pool index. They are rendered as `#7` rather than as
 * a bare number, exactly like `javap -c` does, so the reference reads as a pool lookup.
 */
export const CONSTANT_POOL_OPERAND_MNEMONICS: ReadonlySet<string> = new Set([
  'invokestatic',
  'invokevirtual',
  'invokespecial',
  'invokeinterface',
  'invokedynamic',
  'getstatic',
  'putstatic',
  'getfield',
  'putfield',
  'ldc',
  'ldc_w',
  'ldc2_w',
  'new',
  'anewarray',
  'checkcast',
  'instanceof',
  'multianewarray',
]);

export function hasConstantPoolOperand(instruction: Instruction): boolean {
  return CONSTANT_POOL_OPERAND_MNEMONICS.has(instruction.mnemonic);
}

/** Operand text for one instruction row; empty when the instruction has no operands. */
export function formatOperands(instruction: Instruction): string {
  // Jumps show the absolute target instead of the raw signed delta, same as `javap -c`.
  if (instruction.branchTarget !== undefined) {
    return String(instruction.branchTarget);
  }
  if (hasConstantPoolOperand(instruction)) {
    return instruction.operands.map((operand) => `#${String(operand)}`).join(', ');
  }
  return instruction.operands.join(', ');
}
