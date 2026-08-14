import { NO_CONSOLE_OUTPUT, NO_EXTERNALS, NO_HEAP, type Snapshot, type StackFrame } from '../types';

type Recorded = 'operandKinds' | 'localKinds' | 'operandOrigins' | 'localOrigins';

type FrameSpec = Omit<StackFrame, Recorded> & Partial<Pick<StackFrame, Recorded>>;

type MachineState = 'heap' | 'consoleOutput' | 'externals';

type SnapshotSpec = Omit<Snapshot, MachineState> & Partial<Pick<Snapshot, MachineState>>;

const NO_ORIGINS: readonly number[] = Object.freeze([]);

export function frameOf(frame: FrameSpec): StackFrame {
  return {
    ...frame,
    operandKinds: frame.operandKinds ?? frame.operandStack.map(() => 'int'),
    localKinds:
      frame.localKinds ?? frame.locals.map((value) => (value === undefined ? undefined : 'int')),
    operandOrigins: frame.operandOrigins ?? NO_ORIGINS,
    localOrigins: frame.localOrigins ?? NO_ORIGINS,
  };
}

export function snapshotOf(snapshot: SnapshotSpec): Snapshot {
  return {
    ...snapshot,
    heap: snapshot.heap ?? NO_HEAP,
    consoleOutput: snapshot.consoleOutput ?? NO_CONSOLE_OUTPUT,
    externals: snapshot.externals ?? NO_EXTERNALS,
  };
}
