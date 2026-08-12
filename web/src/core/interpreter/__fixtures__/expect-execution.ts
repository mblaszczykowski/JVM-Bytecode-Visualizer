import { describeFault } from '../errors';
import type { ExecutionResult, Snapshot, StackFrame, VmError } from '../types';

type CompletedRun = Extract<ExecutionResult, { kind: 'completed' }>;
type StepLimitRun = Extract<ExecutionResult, { kind: 'step-limit' }>;

export function expectCompleted(result: ExecutionResult): CompletedRun {
  if (result.kind !== 'completed') {
    throw new Error(`expected a completed run, got ${describe(result)}`);
  }
  return result;
}

export function expectVmError(result: ExecutionResult): VmError {
  if (result.kind !== 'vm-error') {
    throw new Error(`expected a vm-error, got ${describe(result)}`);
  }
  return result.error;
}

export function expectStepLimit(result: ExecutionResult): StepLimitRun {
  if (result.kind !== 'step-limit') {
    throw new Error(`expected a step-limit, got ${describe(result)}`);
  }
  return result;
}

export function debugVmError(error: VmError): string {
  const described = error.kind === 'uncaught-exception' ? error.label : describeFault(error);
  return `${described} (offset ${String(error.offset)} in ${error.methodName}()).`;
}

export function lastFrameOf(snapshots: readonly Snapshot[], methodName: string): StackFrame {
  for (const snapshot of [...snapshots].reverse()) {
    const frame = snapshot.callStack
      .filter((candidate) => candidate.methodName === methodName)
      .at(-1);
    if (frame !== undefined) {
      return frame;
    }
  }
  throw new Error(`no snapshot contains a frame of ${methodName}()`);
}

export function localValue(frame: StackFrame, name: string): number | undefined {
  const slot = frame.localNames.indexOf(name);
  return slot === -1 ? undefined : frame.locals[slot];
}

export function maxCallStackDepth(snapshots: readonly Snapshot[]): number {
  return snapshots.reduce((deepest, snapshot) => Math.max(deepest, snapshot.callStack.length), 0);
}

function describe(result: ExecutionResult): string {
  return result.kind === 'vm-error' ? `vm-error (${result.error.kind})` : result.kind;
}
