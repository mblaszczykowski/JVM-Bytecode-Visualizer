import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { AppShell } from './components/AppShell';
import { BytecodePanel } from './components/BytecodePanel';
import { CompileEditor, SEED_SOURCE } from './components/CompileEditor';
import { ErrorBanner } from './components/ErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { ExampleOption } from './components/ExamplePicker';
import { LoadingPanels } from './components/LoadingPanels';
import { SourcePanel } from './components/SourcePanel';
import { StateColumn } from './components/StateColumn';
import { Toolbar, type CompilerStatus, type PanelName } from './components/Toolbar';
import { TransportControls } from './components/TransportControls';
import { WelcomeScreen, type WelcomeExample } from './components/WelcomeScreen';
import type { Snapshot, StackFrame } from './core/interpreter';
import { useExecutionPlayer } from './hooks/useExecutionPlayer';
import { useTransportShortcuts } from './hooks/useTransportShortcuts';
import {
  appReducer,
  exampleEntriesOf,
  examplesErrorOf,
  failedState,
  initialAppModel,
  loadCompiledState,
  loadExampleState,
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
import { describeAppError, describeCompileFailure, toAppError } from './services/errors';
import { fetchExampleManifest, shortTitleOf } from './services/examples';
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

/** Same reason as NO_SNAPSHOTS: a literal `[]` prop is a new value on every render. */
const NO_FRAMES: readonly StackFrame[] = [];

/** Above 4× the highlight changes rows faster than the projection can read as movement. */
const SMOOTH_HIGHLIGHT_UP_TO = 4;

/** Below 768px the grid holds one panel; everywhere else all three are on screen. */
function visibilityOf(panel: PanelName, selected: PanelName): string {
  return panel === selected ? '' : 'hidden md:flex';
}

/**
 * One macrotask, so React can commit and paint the loading skeleton before the parse and the
 * run block this thread — half a million steps take long enough to freeze the tab otherwise.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * The single place a load may throw: every path into the grid comes through here, so a
 * failure ends as a banner rather than as a skeleton that never goes away.
 */
async function settle(load: () => Promise<AppState> | AppState): Promise<AppState> {
  try {
    return await load();
  } catch (error) {
    return failedState(toAppError(error));
  }
}

interface AppProps {
  /** Base URL of the compile service; `undefined` switches the editor off (ADR-0004). */
  readonly compileApiUrl?: string | undefined;
}

export function App({ compileApiUrl = compileApiBaseUrl() }: AppProps = {}) {
  const [model, dispatch] = useReducer(appReducer, compileApiUrl !== undefined, initialAppModel);
  const { editor, compiler } = model;
  const state = model.load;
  /** Kept outside the model so closing and reopening the editor does not throw the draft away. */
  const [draft, setDraft] = useState(SEED_SOURCE);
  const [visiblePanel, setVisiblePanel] = useState<PanelName>('bytecode');

  const tokenRef = useRef(0);
  const issueToken = useCallback(() => {
    tokenRef.current += 1;
    return tokenRef.current;
  }, []);

  useEffect(() => {
    let active = true;
    void fetchExampleManifest().then(
      (manifest) => {
        if (active) {
          dispatch({ kind: 'examples-loaded', entries: manifest.examples });
        }
      },
      (error: unknown) => {
        if (active) {
          dispatch({ kind: 'examples-failed', error: toAppError(error) });
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
          dispatch({ kind: 'compiler-checked', healthy });
        }
      },
      () => {
        if (active) {
          dispatch({ kind: 'compiler-checked', healthy: false });
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
      const token = issueToken();
      dispatch({ kind: 'load-started', token, label });
      // follow-up: move execute() to a worker for cancellation
      await yieldToPaint();
      dispatch({ kind: 'load-settled', token, state: await settle(load) });
    },
    [issueToken],
  );

  const examples = exampleEntriesOf(model.examples);

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
    dispatch({ kind: 'editor-opened' });
  }, []);

  const closeEditor = useCallback(() => {
    dispatch({ kind: 'editor-closed', token: issueToken() });
  }, [issueToken]);

  const compileDraft = useCallback(async (): Promise<void> => {
    if (compileApiUrl === undefined) {
      return;
    }
    const token = issueToken();
    dispatch({ kind: 'compile-started', token });

    const result = await compile(compileApiUrl, draft);
    if (tokenRef.current !== token) {
      // The editor closed, a program was loaded or a newer compile was issued meanwhile.
      return;
    }
    dispatch({ kind: 'compile-settled', token, result });

    if (result.kind === 'compiled') {
      // `startLoad` closes the editor; the visualization is the answer to the compile.
      void startLoad(`Running ${result.className}`, () =>
        loadCompiledState({
          className: result.className,
          classBytes: result.classBytes,
          source: draft,
        }),
      );
    }
  }, [compileApiUrl, draft, issueToken, startLoad]);

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

  const sourceLine = snapshot?.sourceLine;
  const pcRange = useMemo(
    () =>
      listing === undefined || sourceLine === undefined
        ? undefined
        : offsetsForLine(listing, sourceLine),
    [listing, sourceLine],
  );
  const mappingNote =
    listing === undefined || topFrame === undefined
      ? undefined
      : lineMappingNote(listing, topFrame.pc);
  const next = useMemo(
    () =>
      snapshot === undefined || program === undefined
        ? undefined
        : describeNextInstruction(snapshot, listing, program.classFile),
    [snapshot, listing, program],
  );
  const operandRoles = useMemo(
    () =>
      snapshot === undefined || program === undefined
        ? undefined
        : describeOperandRoles(snapshot, listing, program.classFile),
    [snapshot, listing, program],
  );

  const failure = state.status === 'error' ? describeAppError(state.error) : undefined;
  const examplesError = examplesErrorOf(model.examples);
  const examplesFailure = examplesError === undefined ? undefined : describeAppError(examplesError);
  const compileNotice =
    model.compileFailure === undefined ? undefined : describeCompileFailure(model.compileFailure);
  const nextStepLimit =
    state.status === 'error' && state.error.kind === 'step-limit' && program !== undefined
      ? raisedStepLimit(program.maxSteps)
      : undefined;

  const canReplay = program !== undefined && snapshots.length > 0 && listing !== undefined;
  const smoothHighlight = player.speed <= SMOOTH_HIGHLIGHT_UP_TO;

  const compilerIsUsable = compiler === 'online' || compiler === 'degraded';
  const compilerStatus: CompilerStatus =
    compiler === 'online' ? 'online' : compiler === 'degraded' ? 'offline' : 'hidden';
  const writeJava = compilerIsUsable ? openEditor : undefined;

  // The compile attempt is the newer event, so its banner wins over a stale run failure;
  // examples that never arrived are the oldest news of the three.
  const notice = compileNotice ?? failure ?? examplesFailure;
  const raiseLimit = useMemo(
    () =>
      compileNotice !== undefined || nextStepLimit === undefined || program === undefined
        ? undefined
        : {
            label: 'Raise the limit',
            onAction: () => {
              void startLoad(`Re-running with ${nextStepLimit.toLocaleString('en-US')} steps`, () =>
                rerunState(program, nextStepLimit),
              );
            },
          },
    [compileNotice, nextStepLimit, program, startLoad],
  );

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
          panelSwitch={
            canReplay ? { selected: visiblePanel, onSelect: setVisiblePanel } : undefined
          }
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
            animateHighlight={smoothHighlight}
            className={visibilityOf('source', visiblePanel)}
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
            animateHighlight={smoothHighlight}
            isPlaying={player.isPlaying}
            className={visibilityOf('bytecode', visiblePanel)}
          />
          <StateColumn
            frames={snapshot?.callStack ?? NO_FRAMES}
            operandAnnotations={operandRoles}
            className={`md:col-span-2 lg:col-span-1 ${visibilityOf('state', visiblePanel)}`}
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
