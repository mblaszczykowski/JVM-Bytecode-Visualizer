import { lookupOpcode } from '../core/disassembler';
import type { Instruction } from '../core/disassembler/types';

/** Pool index this instruction names, if any — what a `#n` in its row leads to. */
export function constantIndexOf(instruction: Instruction): number | undefined {
  return operandTokens(instruction).find((token) => token.constantIndex !== undefined)
    ?.constantIndex;
}

/** Operand text for one instruction row; empty when the instruction has no operands. */
export function formatOperands(instruction: Instruction): string {
  return operandTokens(instruction)
    .map((token) => token.text)
    .join(', ');
}

export interface OperandToken {
  readonly text: string;
  /**
   * Whether the operand points somewhere else in the class file — a branch target or a
   * constant pool index. Those are the only two the panel colours (design spec §2.6);
   * a local slot or an immediate is just a number and stays neutral.
   */
  readonly isReference: boolean;
  /**
   * The pool index behind a `#n` token, so the row can be followed into the constant pool
   * table. Absent on every other operand, including branch targets.
   */
  readonly constantIndex?: number;
}

/**
 * Operands of one row, split so each can be styled by what it means. The roles come from the
 * opcode table, so nothing here has to keep a list of which mnemonic takes which operand.
 */
export function operandTokens(instruction: Instruction): readonly OperandToken[] {
  // Jumps show the absolute target instead of the raw signed delta, same as `javap -c`.
  if (instruction.branchTarget !== undefined) {
    return [{ text: String(instruction.branchTarget), isReference: true }];
  }

  // Every assigned opcode carries its operand roles, executable or not, so a `#n` is rendered
  // from the table rather than from a guess about the mnemonic. No fallback is needed: the
  // decoder stops at a byte the table does not know, so an `Instruction` that exists at all
  // has an entry here.
  const specs = lookupOpcode(instruction.opcode)?.operands;

  return instruction.operands.map((operand, position) => {
    const role = specs?.[position]?.role;
    if (role === 'constant-pool-index') {
      return { text: `#${String(operand)}`, isReference: true, constantIndex: operand };
    }
    return { text: String(operand), isReference: role === 'branch-offset' };
  });
}
