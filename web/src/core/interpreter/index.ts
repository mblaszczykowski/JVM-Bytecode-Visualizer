/**
 * Public API of the interpreter layer. The UI imports only from here.
 */
export { formatVmError } from './errors';
export {
  DEFAULT_ENTRY_METHOD,
  execute,
  EXECUTABLE_OPCODES,
  findEntryMethod,
  isEntryMethod,
  type EntryPoint,
} from './interpreter';
export {
  DEFAULT_MAX_CALL_DEPTH,
  DEFAULT_MAX_STEPS,
  type ExecuteOptions,
  type ExecutionResult,
  type Snapshot,
  type StackFrame,
  type VmError,
} from './types';
