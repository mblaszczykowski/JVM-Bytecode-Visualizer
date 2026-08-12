import { parseClassFile } from '../core/classfile';
import { DEFAULT_MAX_STEPS } from '../core/interpreter';

import {
  COMPILER_BUSY,
  type CompileDiagnostic,
  type CompileResult,
  type UnavailableReason,
} from './compile-client';
import { toAppError, type AppError, type CompileFailure } from './errors';
import { fetchExampleResources } from './examples';
import type { ExampleEntry } from './manifest';
import { runProgram, type LoadedProgram } from './program';
import { inlineRunner, isRunCancelled, type LoadContext } from './program-runner';

export type AppState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading';
      readonly label: string;
      readonly steps: number | undefined;
      readonly cancellable: boolean;
      readonly resume: AppState;
    }
  | { readonly status: 'ready'; readonly program: LoadedProgram }
  | {
      readonly status: 'error';
      readonly error: AppError;
      readonly program: LoadedProgram | undefined;
    };

export const MAX_UPLOAD_BYTES = 512 * 1024;

export const MAX_UPLOAD_LABEL = `${String(MAX_UPLOAD_BYTES / 1024)} KiB`;

export const MAX_STEP_LIMIT = 500_000;

const STEP_LIMIT_FACTOR = 5;

const BYTES_PER_STEP = 550;

const MEMORY_SHARE = 1 / 8;

const CONCURRENT_COPIES = 2;

export function affordableStepLimit(): number {
  const gigabytes = reportedDeviceMemory();
  if (gigabytes === undefined) {
    return MAX_STEP_LIMIT;
  }
  const affordable = (gigabytes * 1024 ** 3 * MEMORY_SHARE) / (BYTES_PER_STEP * CONCURRENT_COPIES);
  return Math.max(DEFAULT_MAX_STEPS, Math.min(MAX_STEP_LIMIT, Math.floor(affordable)));
}

function reportedDeviceMemory(): number | undefined {
  const reported = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof reported === 'number' && Number.isFinite(reported) && reported > 0
    ? reported
    : undefined;
}

export const IDLE: AppState = { status: 'idle' };

export function failedState(error: AppError, program?: LoadedProgram): AppState {
  return { status: 'error', error, program };
}

const INLINE_LOAD: LoadContext = { runner: inlineRunner };

export function programOf(state: AppState): LoadedProgram | undefined {
  switch (state.status) {
    case 'ready':
      return state.program;
    case 'error':
      return state.program;
    case 'idle':
    case 'loading':
      return undefined;
  }
}

export function raisedStepLimit(current: number): number | undefined {
  const ceiling = affordableStepLimit();
  if (current >= ceiling) {
    return undefined;
  }
  return Math.min(current * STEP_LIMIT_FACTOR, ceiling);
}

export function stateFor(program: LoadedProgram): AppState {
  switch (program.outcome.kind) {
    case 'completed':
      return { status: 'ready', program };
    case 'vm-error':
      return { status: 'error', error: { kind: 'vm', error: program.outcome.error }, program };
    case 'step-limit':
      return {
        status: 'error',
        error: { kind: 'step-limit', limit: program.outcome.limit },
        program,
      };
    case 'no-entry-point':
      return {
        status: 'error',
        error: { kind: 'no-entry-point', className: program.classFile.thisClassName },
        program,
      };
  }
}

async function settled(
  build: () => Promise<LoadedProgram>,
  loaded?: LoadedProgram,
): Promise<AppState> {
  try {
    return stateFor(await build());
  } catch (error) {
    if (isRunCancelled(error)) {
      throw error;
    }
    return failedState(toAppError(error), loaded);
  }
}

export async function loadExampleState(
  entry: ExampleEntry,
  maxSteps: number = DEFAULT_MAX_STEPS,
  context: LoadContext = INLINE_LOAD,
): Promise<AppState> {
  return settled(async () => {
    const resources = await fetchExampleResources(entry);
    return runProgram(
      {
        origin: { kind: 'example', entry },
        classFile: parseClassFile(resources.classBytes),
        source: { fileName: entry.sourceFile, text: resources.source },
        maxSteps,
      },
      context,
    );
  });
}

export async function loadUploadState(
  file: File,
  maxSteps: number = DEFAULT_MAX_STEPS,
  context: LoadContext = INLINE_LOAD,
): Promise<AppState> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return failedState({
      kind: 'file-too-large',
      fileName: file.name,
      bytes: file.size,
      limit: MAX_UPLOAD_BYTES,
    });
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    return failedState({
      kind: 'file-unreadable',
      fileName: file.name,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return settled(() =>
    runProgram(
      {
        origin: { kind: 'upload', fileName: file.name },
        classFile: parseClassFile(bytes),
        maxSteps,
      },
      context,
    ),
  );
}

export interface CompiledClass {
  readonly className: string;
  readonly classBytes: ArrayBuffer;
  readonly source: string;
}

export function loadCompiledState(
  compiled: CompiledClass,
  maxSteps: number = DEFAULT_MAX_STEPS,
  context: LoadContext = INLINE_LOAD,
): Promise<AppState> {
  if (compiled.classBytes.byteLength > MAX_UPLOAD_BYTES) {
    return Promise.resolve(
      failedState({
        kind: 'file-too-large',
        fileName: `${compiled.className}.class`,
        bytes: compiled.classBytes.byteLength,
        limit: MAX_UPLOAD_BYTES,
      }),
    );
  }

  return settled(() =>
    runProgram(
      {
        origin: { kind: 'compiled', className: compiled.className },
        classFile: parseClassFile(compiled.classBytes),
        source: { fileName: `${compiled.className}.java`, text: compiled.source },
        maxSteps,
      },
      context,
    ),
  );
}

export function rerunState(
  program: LoadedProgram,
  maxSteps: number,
  context: LoadContext = INLINE_LOAD,
): Promise<AppState> {
  return rebuiltState(program, maxSteps, program.entry?.name, context);
}

export function runFromState(
  program: LoadedProgram,
  entryMethod: string,
  context: LoadContext = INLINE_LOAD,
): Promise<AppState> {
  return rebuiltState(program, program.maxSteps, entryMethod, context);
}

function rebuiltState(
  program: LoadedProgram,
  maxSteps: number,
  entryMethod: string | undefined,
  context: LoadContext,
): Promise<AppState> {
  return settled(
    () =>
      runProgram(
        {
          origin: program.origin,
          classFile: program.classFile,
          source: sourceOf(program),
          maxSteps,
          entryMethod,
        },
        context,
      ),
    program,
  );
}

function sourceOf(program: LoadedProgram): { fileName: string; text: string } | undefined {
  return program.origin.kind === 'upload'
    ? undefined
    : { fileName: program.sourceFileName, text: program.sourceLines.join('\n') };
}

export type CompilerAvailability =
  'unconfigured' | 'checking' | 'online' | 'degraded' | 'unavailable';

export type EditorView =
  | { readonly kind: 'closed' }
  | { readonly kind: 'editing'; readonly diagnostics: readonly CompileDiagnostic[] }
  | { readonly kind: 'compiling' };

export type ExamplesStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly entries: readonly ExampleEntry[] }
  | { readonly kind: 'failed'; readonly error: AppError };

const NO_DIAGNOSTICS: readonly CompileDiagnostic[] = [];
const NO_ENTRIES: readonly ExampleEntry[] = [];

const CLOSED_EDITOR: EditorView = { kind: 'closed' };
const EDITING: EditorView = { kind: 'editing', diagnostics: NO_DIAGNOSTICS };

export interface AppModel {
  readonly load: AppState;
  readonly editor: EditorView;
  readonly compiler: CompilerAvailability;
  readonly examples: ExamplesStatus;
  readonly compileFailure: CompileFailure | undefined;
  readonly loadToken: number;
  readonly compileToken: number;
}

export type AppAction =
  | {
      readonly kind: 'load-started';
      readonly token: number;
      readonly label: string;
      readonly cancellable: boolean;
    }
  | { readonly kind: 'load-progress'; readonly token: number; readonly steps: number }
  | { readonly kind: 'load-cancelled'; readonly token: number }
  | { readonly kind: 'load-settled'; readonly token: number; readonly state: AppState }
  | { readonly kind: 'examples-loaded'; readonly entries: readonly ExampleEntry[] }
  | { readonly kind: 'examples-failed'; readonly error: AppError }
  | { readonly kind: 'compiler-checked'; readonly healthy: boolean }
  | { readonly kind: 'editor-opened' }
  | { readonly kind: 'editor-closed'; readonly token: number }
  | { readonly kind: 'compile-started'; readonly token: number }
  | { readonly kind: 'compile-settled'; readonly token: number; readonly result: CompileResult };

export function initialAppModel(compilerConfigured: boolean): AppModel {
  return {
    load: IDLE,
    editor: CLOSED_EDITOR,
    compiler: compilerConfigured ? 'checking' : 'unconfigured',
    examples: { kind: 'loading' },
    compileFailure: undefined,
    loadToken: 0,
    compileToken: 0,
  };
}

export function appReducer(model: AppModel, action: AppAction): AppModel {
  switch (action.kind) {
    case 'load-started':
      return {
        ...model,
        load: {
          status: 'loading',
          label: action.label,
          steps: undefined,
          cancellable: action.cancellable,
          resume: model.load.status === 'loading' ? model.load.resume : model.load,
        },
        editor: CLOSED_EDITOR,
        compileFailure: undefined,
        loadToken: action.token,
        compileToken: action.token,
      };
    case 'load-progress':
      return action.token === model.loadToken && model.load.status === 'loading'
        ? { ...model, load: { ...model.load, steps: action.steps } }
        : model;
    case 'load-cancelled':
      return model.load.status === 'loading'
        ? { ...model, load: model.load.resume, loadToken: action.token }
        : model;
    case 'load-settled':
      return action.token === model.loadToken ? { ...model, load: action.state } : model;
    case 'examples-loaded':
      return { ...model, examples: { kind: 'ready', entries: action.entries } };
    case 'examples-failed':
      return { ...model, examples: { kind: 'failed', error: action.error } };
    case 'compiler-checked':
      return { ...model, compiler: action.healthy ? 'online' : 'unavailable' };
    case 'editor-opened':
      return { ...model, editor: EDITING, compileFailure: undefined };
    case 'editor-closed':
      return {
        ...model,
        editor: CLOSED_EDITOR,
        compileFailure: undefined,
        compileToken: action.token,
      };
    case 'compile-started':
      return {
        ...model,
        editor: { kind: 'compiling' },
        compileFailure: undefined,
        compileToken: action.token,
      };
    case 'compile-settled':
      return action.token === model.compileToken ? settleCompile(model, action.result) : model;
  }
}

function settleCompile(model: AppModel, result: CompileResult): AppModel {
  const compiler = compilerAfter(model.compiler, result);

  switch (result.kind) {
    case 'compiled':
      return { ...model, compiler };
    case 'diagnostics':
      return {
        ...model,
        compiler,
        editor: { kind: 'editing', diagnostics: result.diagnostics },
        compileFailure: undefined,
      };
    case 'rate-limited':
    case 'unavailable':
      return { ...model, compiler, editor: EDITING, compileFailure: result };
  }
}

function compilerAfter(current: CompilerAvailability, result: CompileResult): CompilerAvailability {
  if (current !== 'online' && current !== 'degraded') {
    return current;
  }
  if (result.kind !== 'unavailable') {
    return 'online';
  }
  return isAtCapacity(result.reason) ? 'online' : 'degraded';
}

function isAtCapacity(reason: UnavailableReason): boolean {
  return reason.kind === 'http' && reason.service?.code === COMPILER_BUSY;
}

export function exampleEntriesOf(status: ExamplesStatus): readonly ExampleEntry[] {
  switch (status.kind) {
    case 'ready':
      return status.entries;
    case 'loading':
    case 'failed':
      return NO_ENTRIES;
  }
}

export function examplesErrorOf(status: ExamplesStatus): AppError | undefined {
  return status.kind === 'failed' ? status.error : undefined;
}
