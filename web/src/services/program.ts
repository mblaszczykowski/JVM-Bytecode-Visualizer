/**
 * The loaded program: everything the panels read, computed once per run.
 *
 * The disassembly of every method and the set of offsets the run actually reached are
 * derived here rather than in render, so replaying the history stays a lookup by index.
 */

import type { ClassFile, LineNumberEntry, LocalVariableEntry } from '../core/classfile';
import { disassemble, type Instruction } from '../core/disassembler';
import {
  DEFAULT_MAX_STEPS,
  execute,
  findEntryMethod,
  type Snapshot,
  type StackFrame,
  type VmError,
} from '../core/interpreter';

import type { ExampleEntry } from './manifest';

export interface MethodListing {
  readonly name: string;
  readonly descriptor: string;
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly instructions: readonly Instruction[];
  /** Set when decoding stopped early — the panel renders a `… not decoded` row for it. */
  readonly truncatedAtOffset: number | undefined;
  readonly lineNumbers: readonly LineNumberEntry[];
  /** LocalVariableTable entries with their pc ranges — a slot can name several variables. */
  readonly localVariables: readonly LocalVariableEntry[];
  /** Offsets reached by this run; everything else is dead code in this run. */
  readonly executedOffsets: ReadonlySet<number>;
}

export type ProgramOrigin =
  | { readonly kind: 'example'; readonly entry: ExampleEntry }
  | { readonly kind: 'upload'; readonly fileName: string }
  /** Compiled from source written in the editor; the source is always available. */
  | { readonly kind: 'compiled'; readonly className: string };

export type ExecutionOutcome =
  | { readonly kind: 'completed'; readonly returnValue: number | undefined }
  | { readonly kind: 'vm-error'; readonly error: VmError }
  | { readonly kind: 'step-limit'; readonly limit: number };

export interface LoadedProgram {
  readonly origin: ProgramOrigin;
  readonly classFile: ClassFile;
  readonly methods: readonly MethodListing[];
  /** Method the run started from; absent only when the class has no usable entry point. */
  readonly entry: MethodListing | undefined;
  readonly sourceFileName: string;
  readonly sourceLines: readonly string[];
  /** Stable across renders — `useExecutionPlayer` treats a new array as a new program. */
  readonly snapshots: readonly Snapshot[];
  readonly outcome: ExecutionOutcome;
  readonly maxSteps: number;
}

export interface ProgramSource {
  readonly fileName: string;
  readonly text: string;
}

export interface BuildProgramInput {
  readonly origin: ProgramOrigin;
  readonly classFile: ClassFile;
  /** The matching `.java`; uploads rarely have one. */
  readonly source?: ProgramSource | undefined;
  readonly maxSteps?: number | undefined;
}

/** Shown instead of source code when a `.class` arrives without its `.java`. */
export const NO_SOURCE_LINES: readonly string[] = [
  '// No .java source for this class file.',
  '//',
  '// Upload only carries the compiled class, so the source panel has nothing to',
  '// highlight. Line numbers still come from the LineNumberTable, and the bytecode',
  '// panel shows the instructions being executed.',
];

export function buildProgram({
  origin,
  classFile,
  source,
  maxSteps = DEFAULT_MAX_STEPS,
}: BuildProgramInput): LoadedProgram {
  const result = execute(classFile, { maxSteps });
  const executed = executedOffsets(result.snapshots);

  const methods = classFile.methods.flatMap<MethodListing>((method) => {
    const { code } = method;
    if (code === undefined) {
      return [];
    }
    const decoded = disassemble(code.code);
    return [
      {
        name: method.name,
        descriptor: method.descriptor,
        maxStack: code.maxStack,
        maxLocals: code.maxLocals,
        instructions: decoded.instructions,
        truncatedAtOffset: decoded.truncatedAtOffset,
        lineNumbers: code.lineNumberTable ?? [],
        localVariables: code.localVariableTable ?? [],
        executedOffsets: executed.get(methodKey(method.name, method.descriptor)) ?? EMPTY_OFFSETS,
      },
    ];
  });

  // The same rule the interpreter starts from, so the panel never opens on a method the run
  // would have refused: static, with a Code attribute and a descriptor inside the int subset.
  const entryPoint = findEntryMethod(classFile);

  return {
    origin,
    classFile,
    methods,
    entry:
      entryPoint === undefined
        ? undefined
        : methods.find(
            (method) =>
              method.name === entryPoint.method.name &&
              method.descriptor === entryPoint.method.descriptor,
          ),
    sourceFileName: source?.fileName ?? fileNameOf(origin),
    sourceLines: source === undefined ? NO_SOURCE_LINES : source.text.split(/\r?\n/),
    snapshots: result.snapshots,
    outcome: outcomeOf(result),
    maxSteps,
  };
}

const EMPTY_OFFSETS: ReadonlySet<number> = new Set<number>();

export function findListing(
  program: LoadedProgram,
  name: string,
  descriptor: string,
): MethodListing | undefined {
  return program.methods.find((method) => method.name === name && method.descriptor === descriptor);
}

/**
 * Listing to show for a snapshot: the method of the top frame, or the entry method once the
 * stack is empty — the terminal snapshot should not blank the panel.
 */
export function listingFor(
  program: LoadedProgram,
  snapshot: Snapshot | undefined,
): MethodListing | undefined {
  const frame = snapshot?.callStack.at(-1);
  if (frame === undefined) {
    return program.entry;
  }
  return findListing(program, frame.methodName, frame.methodDescriptor) ?? program.entry;
}

/** Offsets of `listing` that this run never reached. */
export function deadOffsetsOf(listing: MethodListing): ReadonlySet<number> {
  const dead = new Set<number>();
  for (const instruction of listing.instructions) {
    if (!listing.executedOffsets.has(instruction.offset)) {
      dead.add(instruction.offset);
    }
  }
  return dead;
}

/** JVMS §4.7.12: the current line is the entry with the largest `startPc <= offset`. */
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

/** Byte offsets of every instruction mapped to `line` — the `pc 7–15` pill in the footer. */
export function offsetsForLine(listing: MethodListing, line: number): OffsetRange | undefined {
  const offsets = listing.instructions
    .map((instruction) => instruction.offset)
    .filter((offset) => lineForOffset(listing, offset) === line);

  const from = offsets[0];
  const to = offsets.at(-1);
  return from === undefined || to === undefined ? undefined : { from, to };
}

/** Spells the mapping rule out for the current pc, so the footer reads as a decision. */
export function lineMappingNote(listing: MethodListing, pc: number): string | undefined {
  const line = lineForOffset(listing, pc);
  return line === undefined
    ? undefined
    : `LineNumberTable · largest startPc ≤ ${String(pc)} → line ${String(line)}`;
}

/** Call stack depth per step — the background chart of the scrubber. */
export function depthsOf(snapshots: readonly Snapshot[]): readonly number[] {
  return snapshots.map((snapshot) => snapshot.callStack.length);
}

export function topFrameOf(snapshot: Snapshot | undefined): StackFrame | undefined {
  return snapshot?.callStack.at(-1);
}

export interface RunPreview {
  readonly steps: number;
  readonly maxDepth: number;
  /** Call stack depth bucketed down to a fixed width — the sparkline on a welcome card. */
  readonly profile: readonly number[];
}

/** Nobody browses the welcome screen to watch a runaway loop; a preview gives up early. */
const PREVIEW_MAX_STEPS = 5_000;

const PREVIEW_BUCKETS = 32;

/**
 * The shape of a run, without loading it: how long it is and how deep it goes. Cheap enough
 * to do for all four examples while someone reads the headline — the bundled programs are a
 * few hundred instructions each.
 */
export function previewProgram(classFile: ClassFile): RunPreview {
  const depths = depthsOf(execute(classFile, { maxSteps: PREVIEW_MAX_STEPS }).snapshots);
  const profile: number[] = [];

  for (let bucket = 0; bucket < PREVIEW_BUCKETS; bucket++) {
    const first = Math.floor((bucket * depths.length) / PREVIEW_BUCKETS);
    const last = Math.max(first, Math.floor(((bucket + 1) * depths.length) / PREVIEW_BUCKETS) - 1);
    let deepest = 0;
    for (let step = first; step <= last; step++) {
      deepest = Math.max(deepest, depths[step] ?? 0);
    }
    profile.push(deepest);
  }

  return {
    steps: depths.length,
    maxDepth: depths.reduce((deepest, depth) => Math.max(deepest, depth), 0),
    profile,
  };
}

export interface RunSummary {
  /** Name of the local the program leaves its answer in, e.g. `result`. */
  readonly resultName: string;
  /** Value that local held on the last snapshot that still had a frame. */
  readonly resultValue: number | undefined;
  readonly totalSteps: number;
  readonly maxDepth: number;
  /**
   * What a real JVM computed for this example during the fixtures build. Present only for
   * the bundled examples, and only shown once it agrees with what the run produced.
   */
  readonly referenceValue: number | undefined;
}

/** The local `main` was left holding, by name — the answer the program was written to produce. */
function resultOf(frame: StackFrame | undefined, name: string): number | undefined {
  if (frame === undefined) {
    return undefined;
  }
  const slot = frame.localNames.indexOf(name);
  return slot < 0 ? undefined : frame.locals[slot];
}

/** Last snapshot that still had a frame — the terminal one is empty by definition. */
export function lastLiveSnapshot(snapshots: readonly Snapshot[]): Snapshot | undefined {
  for (let index = snapshots.length - 1; index >= 0; index--) {
    const snapshot = snapshots[index];
    if (snapshot !== undefined && snapshot.callStack.length > 0) {
      return snapshot;
    }
  }
  return undefined;
}

/**
 * What the terminal snapshot has to say. The call stack is empty there, so the numbers come
 * from the history around it: the last frame that still existed carries the result, and the
 * depths carry how far the recursion went.
 *
 * `undefined` for a run that did not finish — a stopped run has an error banner instead.
 */
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
    // A reference the run disagrees with is a bug report, not a badge; it is simply not shown.
    referenceValue:
      entry !== undefined && entry.expectedResult === resultValue
        ? entry.expectedResult
        : undefined,
  };
}

/**
 * First step of the run that stood at each byte offset of `listing`. Clicking an instruction
 * row seeks there, so the map is keyed by offset and scoped to one method — the same offset
 * in another method is another instruction.
 */
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

/** Same idea for the source panel: the first step the run spent on each line of the file. */
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

function methodKey(name: string, descriptor: string): string {
  return `${name}${descriptor}`;
}

function executedOffsets(snapshots: readonly Snapshot[]): ReadonlyMap<string, Set<number>> {
  const byMethod = new Map<string, Set<number>>();

  for (const snapshot of snapshots) {
    const frame = snapshot.callStack.at(-1);
    const instruction = snapshot.currentInstruction;
    if (frame === undefined || instruction === undefined) {
      continue;
    }
    const key = methodKey(frame.methodName, frame.methodDescriptor);
    const offsets = byMethod.get(key) ?? new Set<number>();
    offsets.add(instruction.offset);
    byMethod.set(key, offsets);
  }

  return byMethod;
}

function outcomeOf(result: ReturnType<typeof execute>): ExecutionOutcome {
  switch (result.kind) {
    case 'completed':
      return { kind: 'completed', returnValue: result.returnValue };
    case 'vm-error':
      return { kind: 'vm-error', error: result.error };
    case 'step-limit':
      return { kind: 'step-limit', limit: result.limit };
  }
}

function fileNameOf(origin: ProgramOrigin): string {
  switch (origin.kind) {
    case 'example':
      return origin.entry.sourceFile;
    case 'upload':
      return origin.fileName;
    case 'compiled':
      return `${origin.className}.java`;
  }
}
