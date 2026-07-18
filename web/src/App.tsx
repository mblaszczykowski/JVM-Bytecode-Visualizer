import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from './components/AppShell';
import { BytecodePanel } from './components/BytecodePanel';
import { CompileEditor, SEED_SOURCE } from './components/CompileEditor';
import { ErrorBanner } from './components/ErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { ExampleOption } from './components/ExamplePicker';
import { LoadingPanels } from './components/LoadingPanels';
import { SourcePanel } from './components/SourcePanel';
import { StateColumn } from './components/StateColumn';
import { Toolbar, type CompilerStatus } from './components/Toolbar';
import { TransportControls } from './components/TransportControls';
import { WelcomeScreen, type WelcomeExample } from './components/WelcomeScreen';
import type { Snapshot } from './core/interpreter';
import { useExecutionPlayer } from './hooks/useExecutionPlayer';
import { useTransportShortcuts } from './hooks/useTransportShortcuts';
import {
  failedState,
  IDLE,
  loadCompiledState,
  loadExampleState,
  loadingState,
  loadUploadState,
  programOf,
  raisedStepLimit,
  rerunState,
  type AppState,
} from './services/app-state';
import {
  checkHealth,
  compile,
  compileApiBaseUrl,
  type CompileDiagnostic,
} from './services/compile-client';
import {
  constantPoolComments,
  describeNextInstruction,
  describeOperandRoles,
} from './services/derivations';
import {
  describeAppError,
  describeCompileFailure,
  toAppError,
  type ErrorPresentation,
} from './services/errors';
import { fetchExampleManifest, shortTitleOf } from './services/examples';
import type { ExampleEntry } from './services/manifest';
import {
  deadOffsetsOf,
  depthsOf,
  lineMappingNote,
  listingFor,
  offsetsForLine,
  topFrameOf,
} from './services/program';

const APP_NAME = 'JVM Bytecode Visualizer';

/** Stable empty history: a fresh array every render would keep rewinding the player. */
const NO_SNAPSHOTS: readonly Snapshot[] = [];

const NO_DIAGNOSTICS: readonly CompileDiagnostic[] = [];

/**
 * Availability of the optional compile service. `unavailable` is the health check having
 * failed at start-up — the editor never appears and the application looks complete without
 * it; `degraded` is the service dropping out mid-session, which is worth saying out loud
 * because the editor is already open with the reader's source in it.
 */
type CompilerAvailability = 'unconfigured' | 'checking' | 'online' | 'degraded' | 'unavailable';

/**
 * The editor is a view over the grid, not a stage of the program lifecycle, so it stays out
 * of `AppState`: `error` plus an open editor is a legal combination, and folding one into the
 * other would either duplicate every status or make that combination unrepresentable.
 */
type EditorView =
  | { readonly kind: 'closed' }
  | { readonly kind: 'editing'; readonly diagnostics: readonly CompileDiagnostic[] }
  | { readonly kind: 'compiling' };

const CLOSED: EditorView = { kind: 'closed' };
const EDITING: EditorView = { kind: 'editing', diagnostics: NO_DIAGNOSTICS };

interface AppProps {
  /** Base URL of the compile service; `undefined` switches the editor off (ADR-0004). */
  readonly compileApiUrl?: string | undefined;
}

export function App({ compileApiUrl = compileApiBaseUrl() }: AppProps = {}) {
  const [state, setState] = useState<AppState>(IDLE);
  const [examples, setExamples] = useState<readonly ExampleEntry[]>([]);
  const [compiler, setCompiler] = useState<CompilerAvailability>(
    compileApiUrl === undefined ? 'unconfigured' : 'checking',
  );
  const [editor, setEditor] = useState<EditorView>(CLOSED);
  /** Kept outside `editor` so closing and reopening does not throw the draft away. */
  const [draft, setDraft] = useState(SEED_SOURCE);
  const [compileNotice, setCompileNotice] = useState<ErrorPresentation | undefined>(undefined);
  const loadCounter = useRef(0);

  useEffect(() => {
    let active = true;
    void fetchExampleManifest().then(
      (manifest) => {
        if (active) {
          setExamples(manifest.examples);
        }
      },
      (error: unknown) => {
        if (active) {
          setState(failedState(toAppError(error)));
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  /** The badge and the editor appear only after the service has answered once (ADR-0004). */
  useEffect(() => {
    if (compileApiUrl === undefined) {
      return;
    }
    let active = true;
    void checkHealth(compileApiUrl).then(
      (healthy) => {
        if (active) {
          setCompiler(healthy ? 'online' : 'unavailable');
        }
      },
      () => {
        if (active) {
          setCompiler('unavailable');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [compileApiUrl]);

  /** Only the most recent load may land: a slow example must not overwrite a newer upload. */
  const startLoad = useCallback(
    async (label: string, load: () => Promise<AppState> | AppState): Promise<void> => {
      loadCounter.current += 1;
      const token = loadCounter.current;
      setState(loadingState(label));
      // A new program takes the grid back; the draft itself survives in `draft`.
      setEditor(CLOSED);
      setCompileNotice(undefined);

      const next = await load();
      if (loadCounter.current === token) {
        setState(next);
      }
    },
    [],
  );

  const selectExample = useCallback(
    (id: string) => {
      const entry = examples.find((example) => example.id === id);
      if (entry === undefined) {
        return;
      }
      void startLoad(`Loading ${entry.title}`, () => loadExampleState(entry));
    },
    [examples, startLoad],
  );

  const selectFile = useCallback(
    (file: File) => {
      void startLoad(`Reading ${file.name}`, () => loadUploadState(file));
    },
    [startLoad],
  );

  const openEditor = useCallback(() => {
    setEditor(EDITING);
  }, []);

  const closeEditor = useCallback(() => {
    setEditor(CLOSED);
    setCompileNotice(undefined);
  }, []);

  const compileDraft = useCallback(async (): Promise<void> => {
    if (compileApiUrl === undefined) {
      return;
    }
    setEditor({ kind: 'compiling' });
    setCompileNotice(undefined);

    const result = await compile(compileApiUrl, draft);
    switch (result.kind) {
      case 'compiled':
        // `startLoad` closes the editor; the visualization is the answer to the compile.
        void startLoad(`Running ${result.className}`, () =>
          loadCompiledState({
            className: result.className,
            classBytes: result.classBytes,
            source: draft,
          }),
        );
        break;
      case 'diagnostics':
        setEditor({ kind: 'editing', diagnostics: result.diagnostics });
        break;
      case 'rate-limited':
      case 'unavailable':
        // The draft stays on screen: the source is fine, the service is not.
        setEditor(EDITING);
        setCompileNotice(describeCompileFailure(result));
        if (result.kind === 'unavailable') {
          setCompiler('degraded');
        }
        break;
    }
  }, [compileApiUrl, draft, startLoad]);

  const requestCompile = useCallback(() => {
    void compileDraft();
  }, [compileDraft]);

  const program = programOf(state);
  const snapshots = program?.snapshots ?? NO_SNAPSHOTS;
  const player = useExecutionPlayer(snapshots);
  const { seekTo, stepCount } = player;
  const snapshot = snapshots[player.stepIndex];

  const seekToStart = useCallback(() => {
    seekTo(0);
  }, [seekTo]);
  const seekToEnd = useCallback(() => {
    seekTo(stepCount - 1);
  }, [seekTo, stepCount]);

  useTransportShortcuts({
    enabled: snapshots.length > 0,
    onTogglePlay: player.togglePlay,
    onStepForward: player.stepForward,
    onStepBack: player.stepBack,
    onSeekToStart: seekToStart,
    onSeekToEnd: seekToEnd,
  });

  const exampleOptions: readonly ExampleOption[] = useMemo(
    () =>
      examples.map((entry) => ({
        id: entry.id,
        name: shortTitleOf(entry),
        description: entry.description,
      })),
    [examples],
  );
  const welcomeExamples: readonly WelcomeExample[] = useMemo(
    () =>
      examples.map((entry) => ({
        id: entry.id,
        title: entry.title,
        description: entry.description,
      })),
    [examples],
  );

  const listing = program === undefined ? undefined : listingFor(program, snapshot);
  const topFrame = topFrameOf(snapshot);

  const deadOffsets = useMemo(
    () => (listing === undefined ? undefined : deadOffsetsOf(listing)),
    [listing],
  );
  const comments = useMemo(
    () =>
      listing === undefined || program === undefined
        ? undefined
        : constantPoolComments(listing, program.classFile),
    [listing, program],
  );
  const depths = useMemo(() => depthsOf(snapshots), [snapshots]);

  const pcRange =
    listing === undefined || snapshot?.sourceLine === undefined
      ? undefined
      : offsetsForLine(listing, snapshot.sourceLine);
  const mappingNote =
    listing === undefined || topFrame === undefined
      ? undefined
      : lineMappingNote(listing, topFrame.pc);
  const next =
    snapshot === undefined || program === undefined
      ? undefined
      : describeNextInstruction(snapshot, program.classFile);
  const operandRoles =
    snapshot === undefined || program === undefined
      ? undefined
      : describeOperandRoles(snapshot, listing, program.classFile);

  const failure = state.status === 'error' ? describeAppError(state.error) : undefined;
  const nextStepLimit =
    state.status === 'error' && state.error.kind === 'step-limit' && program !== undefined
      ? raisedStepLimit(program.maxSteps)
      : undefined;

  const canReplay = program !== undefined && snapshots.length > 0 && listing !== undefined;

  const compilerIsUsable = compiler === 'online' || compiler === 'degraded';
  const compilerStatus: CompilerStatus =
    compiler === 'online' ? 'online' : compiler === 'degraded' ? 'offline' : 'hidden';
  const writeJava = compilerIsUsable ? openEditor : undefined;

  // The compile attempt is the newer event, so its banner wins over a stale run failure.
  const notice = compileNotice ?? failure;
  const raiseLimit =
    compileNotice !== undefined || nextStepLimit === undefined || program === undefined
      ? undefined
      : {
          label: 'Raise the limit',
          onAction: () => {
            void startLoad(`Re-running with ${nextStepLimit.toLocaleString('en-US')} steps`, () =>
              rerunState(program, nextStepLimit),
            );
          },
        };

  return (
    <AppShell
      toolbar={
        <Toolbar
          appName={APP_NAME}
          examples={exampleOptions}
          selectedExampleId={
            program?.origin.kind === 'example' ? program.origin.entry.id : undefined
          }
          onExampleSelected={selectExample}
          onFileSelected={selectFile}
          compilerStatus={compilerStatus}
          onWriteJava={writeJava}
        />
      }
      footer={
        <>
          {notice === undefined ? null : (
            <div className="px-[18px] pt-[14px]">
              <ErrorBanner
                severity={notice.severity}
                message={notice.message}
                action={raiseLimit}
              />
            </div>
          )}
          {canReplay ? (
            <TransportControls
              stepIndex={player.stepIndex}
              stepCount={player.stepCount}
              isPlaying={player.isPlaying}
              speed={player.speed}
              depths={depths}
              onSeek={seekTo}
              onTogglePlay={player.togglePlay}
              onStepForward={player.stepForward}
              onStepBack={player.stepBack}
              onSpeedChange={player.setSpeed}
            />
          ) : null}
        </>
      }
    >
      {editor.kind !== 'closed' ? (
        <CompileEditor
          source={draft}
          onSourceChange={setDraft}
          diagnostics={editor.kind === 'editing' ? editor.diagnostics : NO_DIAGNOSTICS}
          isCompiling={editor.kind === 'compiling'}
          onCompile={requestCompile}
          onClose={closeEditor}
        />
      ) : state.status === 'loading' ? (
        <LoadingPanels label={state.label} />
      ) : canReplay ? (
        <ErrorBoundary
          key={`${program.sourceFileName}:${String(snapshots.length)}:${String(program.maxSteps)}`}
          fallback={(error) => (
            <div className="col-span-full row-span-full flex items-center justify-center p-6">
              <ErrorBanner
                severity="error"
                message={`The panels could not be rendered: ${error.message}. Pick another program to carry on.`}
              />
            </div>
          )}
        >
          <SourcePanel
            fileName={program.sourceFileName}
            lines={program.sourceLines}
            currentLine={snapshot?.sourceLine}
            pcRange={pcRange}
            lineMappingNote={mappingNote}
          />
          <BytecodePanel
            methodName={listing.name}
            methodDescriptor={listing.descriptor}
            maxStack={listing.maxStack}
            maxLocals={listing.maxLocals}
            instructions={listing.instructions}
            currentOffset={topFrame?.pc}
            comments={comments}
            deadOffsets={deadOffsets}
            truncatedAtOffset={listing.truncatedAtOffset}
            next={next}
          />
          <StateColumn
            frames={snapshot?.callStack ?? []}
            operandAnnotations={operandRoles}
            className="md:col-span-2 lg:col-span-1"
          />
        </ErrorBoundary>
      ) : (
        <WelcomeScreen
          examples={welcomeExamples}
          onExampleSelected={selectExample}
          onFileSelected={selectFile}
          onWriteJava={writeJava}
        />
      )}
    </AppShell>
  );
}
