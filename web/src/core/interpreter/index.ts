/**
 * Public API of the interpreter layer. The UI imports only from here.
 */
export {
  DEFAULT_ENTRY_METHOD,
  execute,
  EXECUTABLE_OPCODES,
  isEntryMethod,
  type EntryPoint,
} from './interpreter';
export {
  DEFAULT_MAX_STEPS,
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
