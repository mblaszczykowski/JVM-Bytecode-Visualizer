import type { Snapshot, StackFrame } from '../core/interpreter';

import { constantPoolComments } from './constant-pool';
import { constructsFor, type Construct } from './constructs';
import {
  describeNextInstruction,
  describeOperandRoles,
  type NextInstructionSummary,
} from './derivations';
import { baseMnemonicOf, explainMnemonic } from './opcode-notes';
import {
  consoleLinesOf,
  deadOffsetsOf,
  firstStepByLine,
  firstStepByOffset,
  isCurrentListing,
  lastLiveSnapshot,
  lineForOffset,
  lineMappingNote,
  offsetsForLine,
  runPrintedOutput,
  runSummaryOf,
  topFrameOf,
  type LoadedProgram,
  type MethodListing,
  type OffsetRange,
  type RunSummary,
} from './program';
import { timelineEventsOf, type TimelineEvent } from './timeline';

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
