export { disassemble } from './disassembler';
export {
  arrayTypeName,
  isSupportedOpcode,
  lookupOpcode,
  OPCODES,
  T_INT,
  WIDENED_FORMS,
  type OpcodeInfo,
  type OperandSpec,
} from './opcodes';
export type { DisassembledCode, Instruction, SwitchCase } from './types';
