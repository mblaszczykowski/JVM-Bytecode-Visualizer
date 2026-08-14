import { NO_CONSOLE_OUTPUT, type Snapshot, type StackFrame } from '../../core/interpreter';

import { constantPoolComments } from './constant-pool';
import { constructsFor, type Construct } from './constructs';
import { describeNextInstruction, type NextInstructionSummary } from './derivations';
import { describeOperandRoles } from './operand-roles';
import { baseMnemonicOf, explainMnemonic } from './opcode-notes';
import type { LoadedProgram, MethodListing } from '../loading/program';
import { timelineEventsOf, type TimelineEvent } from './timeline';

export function findListing(
  program: LoadedProgram,
  name: string,
  descriptor: string,
): MethodListing | undefined {
  return program.methods.find((method) => method.name === name && method.descriptor === descriptor);
}

export function defaultListingOf(program: LoadedProgram): MethodListing | undefined {
  return program.entry ?? program.methods.find((method) => method.instructions.length > 0);
}

export function methodKeyOf(method: MethodListing): string {
  return `${method.name}${method.descriptor}`;
}

export function listingToShow(
  program: LoadedProgram,
  snapshot: Snapshot | undefined,
  viewedMethodKey: string | undefined,
): MethodListing | undefined {
  const viewed =
    viewedMethodKey === undefined
      ? undefined
      : program.methods.find((method) => methodKeyOf(method) === viewedMethodKey);
  return viewed ?? listingFor(program, snapshot);
}

export function listingFor(
  program: LoadedProgram,
  snapshot: Snapshot | undefined,
): MethodListing | undefined {
  const frame = snapshot?.callStack.at(-1);
  if (frame === undefined) {
    return defaultListingOf(program);
  }
  return (
    findListing(program, frame.methodName, frame.methodDescriptor) ?? defaultListingOf(program)
  );
}

export function isCurrentListing(
  listing: MethodListing | undefined,
  frame: StackFrame | undefined,
): boolean {
  return (
    listing !== undefined &&
    frame?.methodName === listing.name &&
    frame.methodDescriptor === listing.descriptor
  );
}

export function consoleLinesOf(snapshot: Snapshot | undefined): readonly string[] {
  return snapshot?.consoleOutput ?? NO_CONSOLE_OUTPUT;
}

export function runPrintedOutput(snapshots: readonly Snapshot[]): boolean {
  return snapshots.some((snapshot) => consoleLinesOf(snapshot).length > 0);
}

export function deadOffsetsOf(listing: MethodListing): ReadonlySet<number> {
  const dead = new Set<number>();
  for (const instruction of listing.instructions) {
    if (!listing.executedOffsets.has(instruction.offset)) {
      dead.add(instruction.offset);
    }
  }
  return dead;
}

export function lineForOffset(listing: MethodListing, offset: number): number | undefined {
  let line: number | undefined;
  let bestStartPc = -1;
  for (const entry of listing.lineNumbers) {
    if (entry.startPc <= offset && entry.startPc > bestStartPc) {
      bestStartPc = entry.startPc;
      line = entry.lineNumber;
    }
  }
  return line;
}

export interface OffsetRange {
  readonly from: number;
  readonly to: number;
}

export function offsetsForLine(listing: MethodListing, line: number): OffsetRange | undefined {
  const starts = [...listing.lineNumbers].sort((a, b) => a.startPc - b.startPc);
  let next = 0;
  let coveredFrom = -1;
  let covering: number | undefined;
  let from: number | undefined;
  let to: number | undefined;

  for (const instruction of listing.instructions) {
    for (; next < starts.length; next++) {
      const entry = starts[next];
      if (entry === undefined || entry.startPc > instruction.offset) {
        break;
      }
      if (entry.startPc > coveredFrom) {
        coveredFrom = entry.startPc;
        covering = entry.lineNumber;
      }
    }
    if (covering === line) {
      from ??= instruction.offset;
      to = instruction.offset;
    }
  }

  return from === undefined || to === undefined ? undefined : { from, to };
}

export function lineMappingNote(listing: MethodListing, pc: number): string | undefined {
  const line = lineForOffset(listing, pc);
  return line === undefined
    ? undefined
    : `LineNumberTable · largest startPc ≤ ${String(pc)} → line ${String(line)}`;
}

export function topFrameOf(snapshot: Snapshot | undefined): StackFrame | undefined {
  return snapshot?.callStack.at(-1);
}

export function lastLiveSnapshot(snapshots: readonly Snapshot[]): Snapshot | undefined {
  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index];
    if (snapshot !== undefined && snapshot.callStack.length > 0) {
      return snapshot;
    }
  }
  return undefined;
}

export interface ReferenceCheck {
  readonly expected: number;
  readonly matches: boolean;
}

export interface RunSummary {
  readonly resultName: string;
  readonly resultValue: number | undefined;
  readonly totalSteps: number;
  readonly maxDepth: number;
  readonly reference: ReferenceCheck | undefined;
}

function resultOf(frame: StackFrame | undefined, name: string): number | undefined {
  if (frame === undefined) {
    return undefined;
  }
  const slot = frame.localNames.indexOf(name);
  return slot < 0 ? undefined : frame.locals[slot];
}

export function runSummaryOf(program: LoadedProgram): RunSummary | undefined {
  if (program.outcome.kind !== 'completed') {
    return undefined;
  }

  const entry = program.origin.kind === 'example' ? program.origin.entry : undefined;
  const resultName = entry?.resultVariable ?? 'result';
  const lastLive = lastLiveSnapshot(program.snapshots);
  const resultValue = resultOf(lastLive?.callStack[0], resultName) ?? program.outcome.returnValue;

  let maxDepth = 0;
  for (const snapshot of program.snapshots) {
    maxDepth = Math.max(maxDepth, snapshot.callStack.length);
  }

  return {
    resultName,
    resultValue,
    totalSteps: program.snapshots.length,
    maxDepth,
    reference:
      entry === undefined
        ? undefined
        : { expected: entry.expectedResult, matches: entry.expectedResult === resultValue },
  };
}

export function firstStepByOffset(
  snapshots: readonly Snapshot[],
  listing: MethodListing | undefined,
): ReadonlyMap<number, number> {
  const steps = new Map<number, number>();
  if (listing === undefined) {
    return steps;
  }

  snapshots.forEach((snapshot, index) => {
    const frame = snapshot.callStack.at(-1);
    const offset = snapshot.currentInstruction?.offset;
    if (
      frame?.methodName !== listing.name ||
      frame.methodDescriptor !== listing.descriptor ||
      offset === undefined ||
      steps.has(offset)
    ) {
      return;
    }
    steps.set(offset, index);
  });
  return steps;
}

export function firstStepByLine(snapshots: readonly Snapshot[]): ReadonlyMap<number, number> {
  const steps = new Map<number, number>();
  snapshots.forEach((snapshot, index) => {
    const { sourceLine } = snapshot;
    if (sourceLine !== undefined && !steps.has(sourceLine)) {
      steps.set(sourceLine, index);
    }
  });
  return steps;
}

export interface HistoryView {
  readonly timelineEvents: readonly TimelineEvent[];
  readonly stepForLine: ReadonlyMap<number, number>;
  readonly lastLive: Snapshot | undefined;
  readonly printed: boolean;
  readonly summary: RunSummary | undefined;
}

const NO_TIMELINE_EVENTS: readonly TimelineEvent[] = [];

const NO_STEPS: ReadonlyMap<number, number> = new Map();

export function historyViewOf(program: LoadedProgram | undefined): HistoryView {
  if (program === undefined) {
    return {
      timelineEvents: NO_TIMELINE_EVENTS,
      stepForLine: NO_STEPS,
      lastLive: undefined,
      printed: false,
      summary: undefined,
    };
  }

  const { snapshots } = program;
  return {
    timelineEvents: timelineEventsOf(snapshots),
    stepForLine: firstStepByLine(snapshots),
    lastLive: lastLiveSnapshot(snapshots),
    printed: runPrintedOutput(snapshots),
    summary: runSummaryOf(program),
  };
}

export interface ListingView {
  readonly deadOffsets: ReadonlySet<number> | undefined;
  readonly comments: ReadonlyMap<number, string> | undefined;
  readonly constructs: ReadonlyMap<number, Construct> | undefined;
  readonly sourceLineForOffset: ReadonlyMap<number, number> | undefined;
  readonly mnemonicHelp: ReadonlyMap<string, string>;
  readonly stepForOffset: ReadonlyMap<number, number>;
}

const NO_HELP: ReadonlyMap<string, string> = new Map();

export function mnemonicHelpFor(listing: MethodListing | undefined): ReadonlyMap<string, string> {
  if (listing === undefined) {
    return NO_HELP;
  }
  const help = new Map<string, string>();
  for (const instruction of listing.instructions) {
    const explanation = explainMnemonic(baseMnemonicOf(instruction));
    if (explanation !== undefined) {
      help.set(instruction.mnemonic, explanation);
    }
  }
  return help;
}

export function sourceLinesForOffsets(
  listing: MethodListing | undefined,
): ReadonlyMap<number, number> | undefined {
  if (listing === undefined) {
    return undefined;
  }
  return new Map(
    listing.instructions.flatMap((instruction) => {
      const line = lineForOffset(listing, instruction.offset);
      return line === undefined ? [] : [[instruction.offset, line] as const];
    }),
  );
}

export function listingViewOf(
  program: LoadedProgram | undefined,
  listing: MethodListing | undefined,
): ListingView {
  if (program === undefined || listing === undefined) {
    return {
      deadOffsets: undefined,
      comments: undefined,
      constructs: undefined,
      sourceLineForOffset: undefined,
      mnemonicHelp: NO_HELP,
      stepForOffset: NO_STEPS,
    };
  }

  return {
    deadOffsets: listing.executedOffsets.size === 0 ? undefined : deadOffsetsOf(listing),
    comments: constantPoolComments(listing, program.classFile),
    constructs: constructsFor(
      listing.instructions,
      program.classFile.constantPool,
      listing.name,
      program.classFile.thisClassName,
    ),
    sourceLineForOffset: sourceLinesForOffsets(listing),
    mnemonicHelp: mnemonicHelpFor(listing),
    stepForOffset: firstStepByOffset(program.snapshots, listing),
  };
}

export interface StepView {
  readonly topFrame: StackFrame | undefined;
  readonly isLive: boolean;
  readonly pcRange: OffsetRange | undefined;
  readonly mappingNote: string | undefined;
  readonly next: NextInstructionSummary | undefined;
  readonly operandRoles: readonly (string | undefined)[] | undefined;
  readonly consoleLines: readonly string[] | undefined;
}

export function stepViewOf(
  program: LoadedProgram | undefined,
  snapshot: Snapshot | undefined,
  listing: MethodListing | undefined,
  printed: boolean,
): StepView {
  const topFrame = topFrameOf(snapshot);
  const isLive = isCurrentListing(listing, topFrame);
  const liveListing = isLive ? listing : undefined;
  const sourceLine = snapshot?.sourceLine;

  return {
    topFrame,
    isLive,
    pcRange:
      liveListing === undefined || sourceLine === undefined
        ? undefined
        : offsetsForLine(liveListing, sourceLine),
    mappingNote:
      liveListing === undefined || topFrame === undefined
        ? undefined
        : lineMappingNote(liveListing, topFrame.pc),
    next:
      snapshot === undefined || program === undefined || liveListing === undefined
        ? undefined
        : describeNextInstruction(snapshot, liveListing, program.classFile),
    operandRoles:
      snapshot === undefined || program === undefined
        ? undefined
        : describeOperandRoles(snapshot, liveListing, program.classFile),
    consoleLines: printed ? consoleLinesOf(snapshot) : undefined,
  };
}

export type ProgramView = HistoryView & ListingView & StepView;
