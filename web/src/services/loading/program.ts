import {
  isStatic,
  type ClassFile,
  type LineNumberEntry,
  type LocalVariableEntry,
  type MethodInfo,
} from '../../core/classfile';
import { disassemble, type Instruction } from '../../core/disassembler';
import {
  DEFAULT_ENTRY_METHOD,
  DEFAULT_MAX_STEPS,
  execute,
  isEntryMethod,
  type ExecutionResult,
  type Snapshot,
  type VmError,
  NO_SNAPSHOTS,
} from '../../core/interpreter';

import type { ExampleEntry } from './manifest';
import type { LoadContext } from './program-runner';

export type NotRunnableReason = 'no-code' | 'instance-method' | 'not-an-entry-shape';

export function describeNotRunnable(reason: NotRunnableReason): string {
  switch (reason) {
    case 'no-code':
      return 'no Code attribute: abstract, native, or declared by an interface';
    case 'instance-method':
      return 'an instance method; a run needs a static entry point';
    case 'not-an-entry-shape':
      return 'a run starts from main(String[]), or from a method taking nothing and returning void or int';
  }
}

export interface MethodListing {
  readonly name: string;
  readonly descriptor: string;
  readonly accessFlags: number;
  readonly maxStack: number;
  readonly maxLocals: number;
  readonly instructions: readonly Instruction[];
  readonly indexByOffset: ReadonlyMap<number, number>;
  readonly undecodedFromOffset: number | undefined;
  readonly lineNumbers: readonly LineNumberEntry[];
  readonly localVariables: readonly LocalVariableEntry[];
  readonly executedOffsets: ReadonlySet<number>;
  readonly notRunnable: NotRunnableReason | undefined;
}

export type ProgramOrigin =
  | { readonly kind: 'example'; readonly entry: ExampleEntry }
  | { readonly kind: 'upload'; readonly fileName: string }
  | { readonly kind: 'compiled'; readonly className: string };

export type ExecutionOutcome =
  | { readonly kind: 'completed'; readonly returnValue: number | undefined }
  | { readonly kind: 'vm-error'; readonly error: VmError }
  | { readonly kind: 'step-limit'; readonly limit: number }
  | { readonly kind: 'no-entry-point' };

export interface LoadedProgram {
  readonly origin: ProgramOrigin;
  readonly classFile: ClassFile;
  readonly methods: readonly MethodListing[];
  readonly entry: MethodListing | undefined;
  readonly sourceFileName: string;
  readonly sourceLines: readonly string[];
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
  readonly source?: ProgramSource | undefined;
  readonly maxSteps?: number | undefined;
  readonly entryMethod?: string | undefined;
  readonly entryDescriptor?: string | undefined;
  readonly run?: ExecutionResult | undefined;
}

export const NO_SOURCE_LINES: readonly string[] = [
  '// No .java source for this class file.',
  '//',
  '// The upload carries only the compiled class, so the source panel has nothing to',
  '// highlight. Line numbers still come from the LineNumberTable, and the bytecode',
  '// panel shows the instructions being executed.',
];

export function buildProgram({
  origin,
  classFile,
  source,
  maxSteps = DEFAULT_MAX_STEPS,
  entryMethod,
  entryDescriptor,
  run,
}: BuildProgramInput): LoadedProgram {
  const entry = chooseEntry(classFile, entryMethod, entryDescriptor);
  const result =
    run ??
    (entry === undefined
      ? undefined
      : execute(classFile, {
          entryMethod: entry.name,
          entryDescriptor: entry.descriptor,
          maxSteps,
        }));
  const executed = executedOffsets(result?.snapshots ?? NO_SNAPSHOTS);

  const methods = classFile.methods.map<MethodListing>((method) => {
    const { code } = method;
    const decoded = code === undefined ? undefined : disassemble(code.code);
    return {
      name: method.name,
      descriptor: method.descriptor,
      accessFlags: method.accessFlags,
      maxStack: code?.maxStack ?? 0,
      maxLocals: code?.maxLocals ?? 0,
      instructions: decoded?.instructions ?? NO_INSTRUCTIONS,
      indexByOffset: decoded?.indexByOffset ?? NO_INDEX_BY_OFFSET,
      undecodedFromOffset: decoded?.undecodedFromOffset,
      lineNumbers: code?.lineNumberTable ?? [],
      localVariables: code?.localVariableTable ?? [],
      executedOffsets: executed.get(methodKey(method.name, method.descriptor)) ?? EMPTY_OFFSETS,
      notRunnable: notRunnableReasonOf(method),
    };
  });

  return {
    origin,
    classFile,
    methods,
    entry:
      entry === undefined
        ? undefined
        : methods.find(
            (method) => method.name === entry.name && method.descriptor === entry.descriptor,
          ),
    sourceFileName: source?.fileName ?? fileNameOf(origin),
    sourceLines: source === undefined ? NO_SOURCE_LINES : source.text.split(/\r?\n/),
    snapshots: result?.snapshots ?? NO_SNAPSHOTS,
    outcome: result === undefined ? NO_ENTRY_POINT : outcomeOf(result),
    maxSteps,
  };
}

export async function runProgram(
  input: BuildProgramInput,
  context: LoadContext,
): Promise<LoadedProgram> {
  const entry = chooseEntry(input.classFile, input.entryMethod, input.entryDescriptor);
  if (entry === undefined) {
    return buildProgram(input);
  }

  const run = await runEntry(input.classFile, entry, input.maxSteps ?? DEFAULT_MAX_STEPS, context);
  return buildProgram({ ...input, run });
}

function runEntry(
  classFile: ClassFile,
  entry: MethodInfo,
  maxSteps: number,
  context: LoadContext,
): Promise<ExecutionResult> {
  return context.runner.run(
    { classFile, entryMethod: entry.name, entryDescriptor: entry.descriptor, maxSteps },
    context,
  );
}

const EMPTY_OFFSETS: ReadonlySet<number> = new Set<number>();
const NO_INSTRUCTIONS: readonly Instruction[] = [];
const NO_INDEX_BY_OFFSET: ReadonlyMap<number, number> = new Map();
const NO_ENTRY_POINT: ExecutionOutcome = { kind: 'no-entry-point' };

function notRunnableReasonOf(method: MethodInfo): NotRunnableReason | undefined {
  if (method.code === undefined) {
    return 'no-code';
  }
  if (!isStatic(method.accessFlags)) {
    return 'instance-method';
  }
  if (isEntryMethod(method)) {
    return undefined;
  }
  return 'not-an-entry-shape';
}

function chooseEntry(
  classFile: ClassFile,
  requested: string | undefined,
  descriptor?: string,
): MethodInfo | undefined {
  const runnable = classFile.methods.filter((method) => notRunnableReasonOf(method) === undefined);
  if (requested !== undefined) {
    return runnable.find(
      (method) =>
        method.name === requested && (descriptor === undefined || method.descriptor === descriptor),
    );
  }
  return (
    runnable.find((method) => method.name === DEFAULT_ENTRY_METHOD) ??
    runnable.find((method) => method.name !== CLASS_INITIALISER)
  );
}

const CLASS_INITIALISER = '<clinit>';

export function depthsOf(snapshots: readonly Snapshot[]): readonly number[] {
  return snapshots.map((snapshot) => snapshot.callStack.length);
}

export interface RunPreview {
  readonly steps: number;
  readonly maxDepth: number;
  readonly profile: readonly number[];
}

export const PREVIEW_MAX_STEPS = 5_000;

const PREVIEW_BUCKETS = 32;

export async function previewProgram(
  classFile: ClassFile,
  context: LoadContext,
): Promise<RunPreview> {
  const entry = chooseEntry(classFile, undefined);
  const run =
    entry === undefined ? undefined : await runEntry(classFile, entry, PREVIEW_MAX_STEPS, context);
  const depths = depthsOf(run?.snapshots ?? NO_SNAPSHOTS);
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

function outcomeOf(result: ExecutionResult): ExecutionOutcome {
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
