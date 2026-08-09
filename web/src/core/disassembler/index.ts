export { disassemble } from './disassembler';
export {
  arrayTypeName,
  isSupportedOpcode,
  lookupOpcode,
  OPCODES,
  T_INT,
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
export type { DisassembledCode, Instruction, SwitchCase } from './types';
