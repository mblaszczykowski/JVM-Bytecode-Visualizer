/**
 * Public API of the interpreter layer. The UI imports only from here.
 */
export { formatVmError } from './errors';
export { execute, EXECUTABLE_OPCODES } from './interpreter';
export {
  DEFAULT_MAX_STEPS,
  type ExecuteOptions,
  type ExecutionResult,
  type Snapshot,
  type StackFrame,
  type VmError,
} from './types';
