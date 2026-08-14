import { useReducer, useRef, useState } from 'react';

import { AppShell } from './components/chrome/AppShell';
import { BytecodePanel } from './components/panels/BytecodePanel';
import { ClassPanel } from './components/panels/ClassPanel';
import { CompileEditor, SEED_SOURCE } from './components/dialogs/CompileEditor';
import { ErrorBanner } from './components/ui/ErrorBanner';
import { ErrorBoundary } from './components/chrome/ErrorBoundary';
import type { ExampleOption } from './components/dialogs/ExamplePicker';
import { LoadingPanels } from './components/panels/LoadingPanels';
import { SourcePanel } from './components/panels/SourcePanel';
import { StateColumn } from './components/panels/StateColumn';
import type { ShortcutGroup } from './components/dialogs/KeyboardHelp';
import { Toolbar, type CompilerStatus, type PanelName } from './components/chrome/Toolbar';
import { EmbedBar } from './components/chrome/EmbedBar';
import { structureVisibilityOf, useStructureTabs } from './components/chrome/StructureTabs';
import { TourStrip } from './components/transport/TourStrip';
import { TransportControls } from './components/transport/TransportControls';
import { WelcomeScreen, type WelcomeExample } from './components/welcome/WelcomeScreen';
import { NO_SNAPSHOTS, type StackFrame } from './core/interpreter';
import { useCompilerHealth } from './hooks/useCompilerHealth';
import { useExampleManifest } from './hooks/useExampleManifest';
import { useExamplePreviews } from './hooks/useExamplePreviews';
import { useExecutionPlayer } from './hooks/useExecutionPlayer';
import { useFileDropGuard } from './hooks/useFileDropGuard';
import { useGuidedTour } from './hooks/useGuidedTour';
import { useOpenedLink } from './hooks/useOpenedLink';
import { useUrlSync } from './hooks/useUrlSync';
import { useProgramView } from './hooks/useProgramView';
import { useSelection } from './hooks/useSelection';
import { useTransportShortcuts } from './hooks/useTransportShortcuts';
import {
  appReducer,
  exampleEntriesOf,
  examplesErrorOf,
  initialAppModel,
  loadCompiledState,
  loadExampleState,
  loadUploadState,
  programOf,
  raisedStepLimit,
  rerunState,
  runFromState,
  type AppState,
} from './services/loading/app-state';
import {
  compile,
  compileApiBaseUrl,
  type CompileDiagnostic,
} from './services/loading/compile-client';
import { fullAppUrl, isEmbedded } from './services/session/embed';
import {
  describeAppError,
  describeCompileDiagnostics,
  describeCompileFailure,
} from './services/loading/errors';
import { shortTitleOf } from './services/loading/examples';
import type { MethodListing } from './services/loading/program';
import { stackEffectOf } from './services/views/bytecode-format';
import { listingToShow } from './services/views/program-view';
import { telemetryContextOf } from './services/session/telemetry';
import {
  defaultProgramRunner,
  type LoadContext,
  type ProgramRunner,
} from './services/loading/program-runner';

const APP_NAME = 'JVM Bytecode Visualizer';

const NO_DIAGNOSTICS: readonly CompileDiagnostic[] = [];

const NO_FRAMES: readonly StackFrame[] = [];

const SMOOTH_HIGHLIGHT_UP_TO = 4;

const NO_RUN_NOTE =
  'Nothing was executed, so there is no frame, no operand stack and no locals to describe. ' +
  'The class file is on the left and its listings are in the middle.';

const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Replay',
    shortcuts: [
      { keys: ['Space'], label: 'Play or pause' },
      { keys: ['←'], label: 'Step back' },
      { keys: ['→'], label: 'Step forward' },
      { keys: ['↓'], label: 'Step over the call' },
      { keys: ['↑'], label: 'Step out of the frame' },
      { keys: ['Home'], label: 'First step' },
      { keys: ['End'], label: 'Last step' },
    ],
  },
  {
    title: 'Panels',
    shortcuts: [
      { keys: ['↑', '↓'], label: 'Move between code rows' },
      { keys: ['Enter'], label: 'Run to the focused row' },
      { keys: ['?'], label: 'This sheet' },
      { keys: ['Esc'], label: 'Close a dialog' },
    ],
  },
];

function visibilityOf(panel: PanelName, selected: PanelName): string {
  return panel === selected ? '' : 'hidden md:flex';
}

interface AppProps {
  readonly compileApiUrl?: string | undefined;
  readonly programRunner?: ProgramRunner | undefined;
}

export function App({
  compileApiUrl = compileApiBaseUrl(),
  programRunner = defaultProgramRunner(),
}: AppProps = {}) {
  const [model, dispatch] = useReducer(appReducer, compileApiUrl !== undefined, initialAppModel);
  const { editor, compiler } = model;
  const state = model.load;
  const program = programOf(state);
  const [draft, setDraft] = useState(SEED_SOURCE);
  const selection = useSelection(program?.origin.kind === 'upload' ? 'class' : 'source');

  const tokenRef = useRef(0);
  const issueToken = (): number => {
    tokenRef.current += 1;
    return tokenRef.current;
  };

  const [embedded] = useState(() => isEmbedded(window.location.search));

  useExampleManifest(dispatch);
  useCompilerHealth(compileApiUrl, dispatch);

  const running = useRef<AbortController | undefined>(undefined);
  const startLoad = async (
    label: string,
    load: (context: LoadContext) => Promise<AppState | undefined>,
    compileDiagnostics: readonly CompileDiagnostic[] = NO_DIAGNOSTICS,
  ): Promise<void> => {
    const token = issueToken();
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;

    dispatch({
      kind: 'load-started',
      token,
      label,
      cancellable: programRunner.cancellable,
      compileDiagnostics,
    });
    selection.reset();

    const state = await load({
      runner: programRunner,
      signal: controller.signal,
      onProgress: (steps) => {
        dispatch({ kind: 'load-progress', token, steps });
      },
    });
    if (state !== undefined) {
      dispatch({ kind: 'load-settled', token, state });
    }
  };

  const cancelLoad = () => {
    running.current?.abort();
    dispatch({ kind: 'load-cancelled', token: issueToken() });
  };

  const examples = exampleEntriesOf(model.examples);

  const selectExample = (id: string) => {
    const entry = examples.find((example) => example.id === id);
    if (entry === undefined) {
      return;
    }
    void startLoad(`Loading ${entry.title}`, (context) =>
      loadExampleState(entry, undefined, context),
    );
  };

  const selectFile = (file: File) => {
    void startLoad(`Reading ${file.name}`, (context) => loadUploadState(file, undefined, context));
  };

  const isDropTarget = useFileDropGuard(selectFile);

  const openEditor = () => {
    dispatch({ kind: 'editor-opened' });
  };

  const closeEditor = () => {
    dispatch({ kind: 'editor-closed', token: issueToken() });
  };

  const compileDraft = async (): Promise<void> => {
    if (compileApiUrl === undefined) {
      return;
    }
    const token = issueToken();
    selection.dismiss(undefined);
    dispatch({ kind: 'compile-started', token });

    const result = await compile(compileApiUrl, draft);
    if (tokenRef.current !== token) {
      return;
    }
    dispatch({ kind: 'compile-settled', token, result });

    if (result.kind === 'compiled') {
      void startLoad(
        `Running ${result.className}`,
        (context) =>
          loadCompiledState(
            { className: result.className, classBytes: result.classBytes, source: draft },
            undefined,
            context,
          ),
        result.diagnostics,
      );
    }
  };

  const requestCompile = () => {
    void compileDraft();
  };

  const snapshots = program?.snapshots ?? NO_SNAPSHOTS;
  const player = useExecutionPlayer(snapshots);
  const { seekTo, stepCount } = player;
  const snapshot = snapshots[player.stepIndex];

  const seekToStart = () => {
    seekTo(0);
  };
  const seekToEnd = () => {
    seekTo(stepCount - 1);
  };

  const loadedExampleId = program?.origin.kind === 'example' ? program.origin.entry.id : undefined;

  const openedAt = useOpenedLink({
    examples,
    embedded,
    selectExample,
    loadedExampleId,
    stepCount,
    seekTo,
  });

  const tour = useGuidedTour({ exampleId: loadedExampleId, snapshots, seekTo, openedAt });

  useUrlSync({
    exampleId: loadedExampleId,
    isPlaying: player.isPlaying,
    stepIndex: player.stepIndex,
    stepCount,
    tour:
      tour.active === undefined
        ? undefined
        : { id: tour.active.tour.id, stopIndex: tour.stopIndex },
  });

  useTransportShortcuts({
    enabled: snapshots.length > 0 && editor.kind === 'closed',
    onTogglePlay: player.togglePlay,
    onStepForward: player.stepForward,
    onStepBack: player.stepBack,
    onStepOver: player.stepOver,
    onStepOut: player.stepOut,
    onSeekToStart: seekToStart,
    onSeekToEnd: seekToEnd,
  });

  const previews = useExamplePreviews(examples, programRunner);

  const exampleOptions: readonly ExampleOption[] = examples.map((entry) => ({
    id: entry.id,
    name: shortTitleOf(entry),
    description: entry.description,
  }));
  const welcomeExamples: readonly WelcomeExample[] = examples.map((entry) => ({
    id: entry.id,
    title: entry.title,
    tagline: entry.tagline,
    preview: previews.get(entry.id),
  }));

  const listing =
    program === undefined ? undefined : listingToShow(program, snapshot, selection.viewedMethodKey);

  const currentInstruction = snapshot?.currentInstruction;
  const stackEffect =
    program === undefined || currentInstruction === undefined
      ? undefined
      : stackEffectOf(currentInstruction, program.classFile.constantPool);

  const {
    comments,
    consoleLines,
    constructs,
    deadOffsets,
    isLive,
    lastLive,
    mappingNote,
    mnemonicHelp,
    next,
    operandRoles,
    pcRange,
    sourceLineForOffset,
    stepForLine,
    stepForOffset,
    summary,
    timelineEvents,
    topFrame,
  } = useProgramView(program, snapshot, listing);

  const runMethod = (method: MethodListing) => {
    if (program === undefined) {
      return;
    }
    void startLoad(`Running ${method.name}`, (context) => runFromState(program, method, context));
  };

  const failure = state.status === 'error' ? describeAppError(state.error) : undefined;
  const examplesError = examplesErrorOf(model.examples);
  const examplesFailure = examplesError === undefined ? undefined : describeAppError(examplesError);
  const compileNotice =
    model.compileFailure === undefined ? undefined : describeCompileFailure(model.compileFailure);
  const javacNotice = describeCompileDiagnostics(model.compileDiagnostics);
  const nextStepLimit =
    state.status === 'error' && state.error.kind === 'step-limit' && program !== undefined
      ? raisedStepLimit(program.maxSteps)
      : undefined;

  const canExplore = program !== undefined && listing !== undefined;
  const canReplay = canExplore && snapshots.length > 0;
  const smoothHighlight = player.speed <= SMOOTH_HIGHLIGHT_UP_TO;

  const compilerIsUsable = compiler === 'online' || compiler === 'degraded';
  const compilerStatus: CompilerStatus =
    compiler === 'online' ? 'online' : compiler === 'degraded' ? 'offline' : 'hidden';
  const writeJava = compilerIsUsable ? openEditor : undefined;

  const raised = compileNotice ?? failure ?? examplesFailure ?? javacNotice;
  const notice = raised?.message === selection.dismissed ? undefined : raised;
  const dismissNotice = () => {
    selection.dismiss(raised?.message);
  };

  const structureTabs = useStructureTabs(selection.structureView, selection.selectPanel);

  const raiseLimit =
    compileNotice !== undefined || nextStepLimit === undefined || program === undefined
      ? undefined
      : {
          label: 'Raise the limit',
          onAction: () => {
            void startLoad(
              `Re-running with ${nextStepLimit.toLocaleString('en-US')} steps`,
              (context) => rerunState(program, nextStepLimit, context),
            );
          },
        };

  const showsEditor = editor.kind !== 'closed';
  const showsProgress = state.status === 'loading';
  const showsWelcome = !showsEditor && !showsProgress && !canExplore;
  const welcomeNotice =
    showsWelcome && notice !== undefined
      ? { severity: notice.severity, message: notice.message, onDismiss: dismissNotice }
      : undefined;
  const footerNotice = showsWelcome ? undefined : notice;

  return (
    <AppShell
      toolbar={
        embedded ? (
          <EmbedBar
            appName={APP_NAME}
            programName={program?.sourceFileName ?? program?.classFile.thisClassName}
            fullUrl={fullAppUrl(window.location.href)}
          />
        ) : (
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
              canExplore
                ? { selected: selection.visiblePanel, onSelect: selection.selectPanel }
                : undefined
            }
            shortcuts={SHORTCUTS}
          />
        )
      }
      isDropTarget={isDropTarget}
      footer={
        <>
          {!canReplay ? null : (
            <TourStrip
              available={tour.available}
              active={tour.active}
              stopIndex={tour.stopIndex}
              onStart={tour.start}
              onGoToStop={tour.goToStop}
              onLeave={tour.leave}
            />
          )}
          {footerNotice === undefined ? null : (
            <div className="px-4 pt-3.5">
              <ErrorBanner
                severity={footerNotice.severity}
                message={footerNotice.message}
                action={raiseLimit}
                onDismiss={dismissNotice}
              />
            </div>
          )}
          {canReplay ? (
            <TransportControls
              stepIndex={player.stepIndex}
              stepCount={stepCount}
              isPlaying={player.isPlaying}
              speed={player.speed}
              depths={player.depths}
              events={timelineEvents}
              onSeek={seekTo}
              onTogglePlay={player.togglePlay}
              onStepForward={player.stepForward}
              onStepBack={player.stepBack}
              onStepOver={player.stepOver}
              onStepOut={player.stepOut}
              canStepOver={player.canStepOver}
              canStepOut={player.canStepOut}
              onSpeedChange={player.setSpeed}
            />
          ) : null}
        </>
      }
    >
      {showsEditor ? (
        <CompileEditor
          source={draft}
          onSourceChange={setDraft}
          diagnostics={editor.kind === 'editing' ? editor.diagnostics : NO_DIAGNOSTICS}
          isCompiling={editor.kind === 'compiling'}
          onCompile={requestCompile}
          onClose={closeEditor}
        />
      ) : showsProgress ? (
        <LoadingPanels
          label={state.label}
          steps={state.steps}
          onCancel={state.cancellable ? cancelLoad : undefined}
        />
      ) : canExplore ? (
        <ErrorBoundary
          key={`${program.sourceFileName}:${String(snapshots.length)}:${String(program.maxSteps)}`}
          context={{
            program: telemetryContextOf(program),
            step: player.stepIndex,
            totalSteps: stepCount,
          }}
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
            stepForLine={stepForLine}
            onSeek={seekTo}
            linkedLine={selection.linkedLine}
            onLinkedLineChange={selection.linkLine}
            animateHighlight={smoothHighlight}
            titleControl={selection.structureView === 'source' ? structureTabs : undefined}
            className={structureVisibilityOf(
              'source',
              selection.visiblePanel,
              selection.structureView,
            )}
          />
          <ClassPanel
            classFile={program.classFile}
            methods={program.methods}
            selectedMethod={listing}
            onSelectMethod={selection.selectMethod}
            onRunMethod={runMethod}
            entryMethod={program.entry}
            selectedConstant={selection.selectedConstant}
            onSelectConstant={selection.selectConstant}
            titleControl={selection.structureView === 'class' ? structureTabs : undefined}
            className={structureVisibilityOf(
              'class',
              selection.visiblePanel,
              selection.structureView,
            )}
          />
          <BytecodePanel
            methodName={listing.name}
            methodDescriptor={listing.descriptor}
            maxStack={listing.maxStack}
            maxLocals={listing.maxLocals}
            instructions={listing.instructions}
            currentOffset={isLive ? topFrame?.pc : undefined}
            comments={comments}
            deadOffsets={deadOffsets}
            undecodedFromOffset={listing.undecodedFromOffset}
            next={next}
            help={mnemonicHelp}
            stepForOffset={stepForOffset}
            onSeek={seekTo}
            constantPool={program.classFile.constantPool}
            constructs={constructs}
            sourceLineForOffset={sourceLineForOffset}
            linkedLine={selection.linkedLine}
            onLinkedLineChange={selection.linkLine}
            selectedConstant={selection.selectedConstant}
            onSelectConstant={selection.followConstantFromListing}
            animateHighlight={smoothHighlight}
            className={visibilityOf('bytecode', selection.visiblePanel)}
          />
          <StateColumn
            frames={snapshot?.callStack ?? NO_FRAMES}
            operandAnnotations={operandRoles}
            heap={snapshot?.heap}
            externals={snapshot?.externals}
            mnemonic={currentInstruction?.mnemonic}
            stackEffect={stackEffect}
            lastLiveFrames={lastLive?.callStack}
            summary={summary}
            consoleLines={consoleLines}
            isPlaying={player.isPlaying}
            stepIndex={player.stepIndex}
            onSeekToStep={seekTo}
            noRunNote={snapshots.length === 0 ? NO_RUN_NOTE : undefined}
            className={`md:col-span-2 lg:col-span-1 ${visibilityOf('state', selection.visiblePanel)}`}
          />
        </ErrorBoundary>
      ) : (
        <WelcomeScreen
          examples={welcomeExamples}
          onExampleSelected={selectExample}
          onFileSelected={selectFile}
          onWriteJava={writeJava}
          notice={welcomeNotice}
        />
      )}
    </AppShell>
  );
}
