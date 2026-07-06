/**
 * Publiczne API warstwy parsera plików `.class` (plan.md §9 Faza 1).
 * Disassembler, interpreter i UI importują wyłącznie stąd.
 */
export { ByteReader } from './byte-reader';
export {
  ClassFileError,
  formatClassFileError,
  isClassFileError,
  type ClassFileErrorDetail,
} from './errors';
export {
  formatJvmType,
  parseFieldDescriptor,
  parseMethodDescriptor,
  type ArrayType,
  type ClassType,
  type JvmReturnType,
  type JvmType,
  type MethodDescriptor,
  type PrimitiveType,
  type PrimitiveTypeName,
  type VoidType,
} from './descriptor';
export { parseClassFile } from './parser';
export {
  AccessFlag,
  ConstantTag,
  isStatic,
  type ClassFile,
  type ClassConstant,
  type CodeAttribute,
  type ConstantPool,
  type ConstantPoolEntry,
  type FieldInfo,
  type FieldrefConstant,
  type IntegerConstant,
  type LineNumberEntry,
  type LocalVariableEntry,
  type MethodInfo,
  type MethodrefConstant,
  type NameAndTypeConstant,
  type StringConstant,
  type UninterpretedConstant,
  type UninterpretedConstantTag,
  type Utf8Constant,
} from './types';
