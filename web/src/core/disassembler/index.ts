/**
 * Public API of the disassembler layer. The interpreter and the UI import only from here.
 */
export { disassemble } from './disassembler';
export {
  isSupportedOpcode,
  lookupOpcode,
  operandWidth,
  OPCODES,
  type OpcodeInfo,
  type OperandRole,
  type OperandSpec,
  type OperandType,
  type ReservedOpcode,
  type StackEffect,
  type SupportedOpcode,
  type UnsupportedOpcode,
  type VariableLengthOpcode,
} from './opcodes';
export type { DisassembledCode, Instruction } from './types';
