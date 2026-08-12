export {
  DEFAULT_ENTRY_METHOD,
  execute,
  EXECUTABLE_OPCODES,
  findEntryMethod,
  isEntryMethod,
  type EntryPoint,
} from './interpreter';
export {
  DEFAULT_MAX_STEPS,
  NO_SNAPSHOTS,
  type ArrayObject,
  type FieldSlot,
  type HeapObject,
  type InstanceObject,
  type ExecuteOptions,
  type ExternalValue,
  type ExecutionResult,
  type Snapshot,
  type StackFrame,
  type ValueKind,
  type VmError,
} from './types';
export { EXTERNAL_METHODS, memberKey, type ExternalMethod } from './externals';
export { NULL_REFERENCE } from './heap';
export {
  i2b,
  i2c,
  i2s,
  iadd,
  iand,
  idiv,
  imul,
  ineg,
  ior,
  irem,
  ishl,
  ishr,
  isub,
  iushr,
  ixor,
} from './int32';
