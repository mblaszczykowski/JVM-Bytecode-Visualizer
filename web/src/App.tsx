import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { AppShell } from './components/AppShell';
import { BytecodePanel } from './components/BytecodePanel';
import { ClassPanel } from './components/ClassPanel';
import { CompileEditor, SEED_SOURCE } from './components/CompileEditor';
import { ErrorBanner } from './components/ErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { ExampleOption } from './components/ExamplePicker';
import { LoadingPanels } from './components/LoadingPanels';
import { SourcePanel } from './components/SourcePanel';
import { StateColumn } from './components/StateColumn';
import type { ShortcutGroup } from './components/KeyboardHelp';
import { Toolbar, type CompilerStatus, type PanelName } from './components/Toolbar';
import { EmbedBar } from './components/EmbedBar';
import { TourStrip } from './components/TourStrip';
import { TransportControls } from './components/TransportControls';
import { Segment, SegmentedControl } from './components/ui/SegmentedControl';
import { WelcomeScreen, type WelcomeExample } from './components/WelcomeScreen';
import type { Snapshot, StackFrame } from './core/interpreter';
import { useExamplePreviews } from './hooks/useExamplePreviews';
import { useExecutionPlayer } from './hooks/useExecutionPlayer';
import { useFileDropGuard } from './hooks/useFileDropGuard';
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
  runFromState,
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
  explainMnemonic,
} from './services/derivations';
import { parseDeepLink, writeDeepLink, writeTourLink } from './services/deep-link';
import { constructsFor } from './services/constructs';
import { fullAppUrl, isEmbedded } from './services/embed';
import { describeAppError, describeCompileFailure, toAppError } from './services/errors';
import { fetchExampleManifest, shortTitleOf } from './services/examples';
import {
  consoleLinesOf,
  deadOffsetsOf,
  depthsOf,
  firstStepByLine,
  firstStepByOffset,
  isCurrentListing,
  lastLiveSnapshot,
  lineForOffset,
  lineMappingNote,
  listingToShow,
  methodKeyOf,
  offsetsForLine,
  runPrintedOutput,
  runSummaryOf,
  topFrameOf,
  type LoadedProgram,
  type MethodListing,
} from './services/program';
import type { ProgramContext } from './services/telemetry';
import { resolveTour, tourFor, toursFor, type Tour } from './services/tours';
import {
  defaultProgramRunner,
  isRunCancelled,
  type LoadContext,
  type ProgramRunner,
} from './services/program-runner';
import { timelineEventsOf } from './services/timeline';

const APP_NAME = 'JVM Bytecode Visualizer';

const NO_SNAPSHOTS: readonly Snapshot[] = [];

const NO_DIAGNOSTICS: readonly CompileDiagnostic[] = [];

const NO_TOURS: readonly Tour[] = [];

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

function telemetryContextOf(program: LoadedProgram): ProgramContext {
  const { origin } = program;
  switch (origin.kind) {
    case 'example':
      return { origin: 'example', exampleId: origin.entry.id };
    case 'upload':
      return { origin: 'upload', methods: program.methods.length };
    case 'compiled':
      return { origin: 'compiled', methods: program.methods.length };
  }
}

function visibilityOf(panel: PanelName, selected: PanelName): string {
  return panel === selected ? '' : 'hidden md:flex';
}

function structureVisibilityOf(
  panel: StructureView,
  selected: PanelName,
  shown: StructureView,
): string {
  return `${panel === selected ? '' : 'hidden'} ${panel === shown ? 'md:flex' : 'md:hidden'}`;
}

function mnemonicHelpFor(listing: MethodListing | undefined): ReadonlyMap<string, string> {
  const help = new Map<string, string>();
  for (const instruction of listing?.instructions ?? []) {
    const explanation = explainMnemonic(instruction.mnemonic);
    if (explanation !== undefined) {
      help.set(instruction.mnemonic, explanation);
    }
  }
  return help;
}

type StructureView = 'source' | 'class';

const STRUCTURE_VIEWS: readonly {
  readonly id: StructureView;
  readonly label: string;
  readonly name: string;
}[] = [
  { id: 'source', label: 'Source', name: 'Source: the Java this class was compiled from' },
  { id: 'class', label: 'Class', name: 'Class: the structure of the class file itself' },
];

async function settle(load: () => Promise<AppState>): Promise<AppState | undefined> {
  try {
    return await load();
  } catch (error) {
    return isRunCancelled(error) ? undefined : failedState(toAppError(error));
  }
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
  const [draft, setDraft] = useState(SEED_SOURCE);
  const [visiblePanel, setVisiblePanel] = useState<PanelName>('bytecode');
  const [structureChoice, setStructureChoice] = useState<StructureView | undefined>(undefined);
  const [viewedMethodKey, setViewedMethodKey] = useState<string | undefined>(undefined);
  const [selectedConstant, setSelectedConstant] = useState<number | undefined>(undefined);
  const [linkedLine, setLinkedLine] = useState<number | undefined>(undefined);
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);

  const tokenRef = useRef(0);
  const issueToken = (): number => {
    tokenRef.current += 1;
    return tokenRef.current;
  };

  const [openedAt] = useState(() => parseDeepLink(window.location.hash));
  const [embedded] = useState(() => isEmbedded(window.location.search));
  const pendingExample = useRef(openedAt?.exampleId);
  const pendingStep = useRef(openedAt?.stepIndex);
  const pendingTour = useRef(openedAt?.tour);
  const [tourId, setTourId] = useState<string | undefined>(undefined);
  const [tourStop, setTourStop] = useState(0);

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

  const running = useRef<AbortController | undefined>(undefined);
  const startLoad = async (
    label: string,
    load: (context: LoadContext) => Promise<AppState>,
  ): Promise<void> => {
    const token = issueToken();
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;

    dispatch({ kind: 'load-started', token, label, cancellable: programRunner.cancellable });
    setViewedMethodKey(undefined);
    setSelectedConstant(undefined);
    setLinkedLine(undefined);
    setStructureChoice(undefined);

    const state = await settle(() =>
      load({
        runner: programRunner,
        signal: controller.signal,
        onProgress: (steps) => {
          dispatch({ kind: 'load-progress', token, steps });
        },
      }),
    );
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

  useEffect(() => {
    const id = pendingExample.current ?? (embedded ? examples[0]?.id : undefined);
    if (id === undefined || examples.length === 0) {
      return;
    }
    pendingExample.current = undefined;
    selectExample(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examples, embedded]);

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
    dispatch({ kind: 'compile-started', token });

    const result = await compile(compileApiUrl, draft);
    if (tokenRef.current !== token) {
      return;
    }
    dispatch({ kind: 'compile-settled', token, result });

    if (result.kind === 'compiled') {
      void startLoad(`Running ${result.className}`, (context) =>
        loadCompiledState(
          { className: result.className, classBytes: result.classBytes, source: draft },
          undefined,
          context,
        ),
      );
    }
  };

  const requestCompile = () => {
    void compileDraft();
  };

  const program = programOf(state);
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

  useEffect(() => {
    const step = pendingStep.current;
    if (step === undefined || stepCount === 0) {
      return;
    }
    pendingStep.current = undefined;
    if (loadedExampleId === openedAt?.exampleId && step < stepCount) {
      seekTo(step);
    }
  }, [loadedExampleId, openedAt, stepCount, seekTo]);

  const availableTours = loadedExampleId === undefined ? NO_TOURS : toursFor(loadedExampleId);
  const activeTour = useMemo(() => {
    if (loadedExampleId === undefined || tourId === undefined) {
      return undefined;
    }
    const tour = tourFor(loadedExampleId, tourId);
    if (tour === undefined) {
      return undefined;
    }
    const stops = resolveTour(tour, snapshots);
    return stops.length === 0 ? undefined : { tour, stops };
  }, [loadedExampleId, tourId, snapshots]);

  const goToStop = (index: number) => {
    const stop = activeTour?.stops[index];
    if (stop === undefined) {
      return;
    }
    setTourStop(index);
    seekTo(stop.step);
  };

  const startTour = (id: string) => {
    setTourId(id);
    setTourStop(0);
  };

  const leaveTour = () => {
    setTourId(undefined);
    setTourStop(0);
  };

  useEffect(() => {
    const link = pendingTour.current;
    if (link === undefined || stepCount === 0 || loadedExampleId !== openedAt?.exampleId) {
      return;
    }
    pendingTour.current = undefined;
    setTourId(link.tourId);
    setTourStop(link.stopIndex);
  }, [loadedExampleId, openedAt, stepCount]);

  useEffect(() => {
    const stop = activeTour?.stops[tourStop];
    if (stop !== undefined) {
      seekTo(stop.step);
    }
  }, [activeTour, tourStop, seekTo]);

  useEffect(() => {
    if (loadedExampleId === undefined) {
      return;
    }
    if (activeTour !== undefined) {
      writeTourLink(loadedExampleId, activeTour.tour.id, tourStop);
      return;
    }
    writeDeepLink(loadedExampleId, stepCount === 0 ? undefined : player.stepIndex);
  }, [loadedExampleId, activeTour, tourStop, player.stepIndex, stepCount]);

  useTransportShortcuts({
    enabled: snapshots.length > 0,
    onTogglePlay: player.togglePlay,
    onStepForward: player.stepForward,
    onStepBack: player.stepBack,
    onStepOver: player.stepOver,
    onStepOut: player.stepOut,
    onSeekToStart: seekToStart,
    onSeekToEnd: seekToEnd,
  });

  const previews = useExamplePreviews(examples);

  const exampleOptions: readonly ExampleOption[] = examples.map((entry) => ({
    id: entry.id,
    name: shortTitleOf(entry),
    tagline: entry.tagline,
    description: entry.description,
  }));
  const welcomeExamples: readonly WelcomeExample[] = examples.map((entry) => ({
    id: entry.id,
    title: entry.title,
    tagline: entry.tagline,
    preview: previews.get(entry.id),
  }));

  const topFrame = topFrameOf(snapshot);
  const listing = useMemo(
    () => (program === undefined ? undefined : listingToShow(program, snapshot, viewedMethodKey)),
    [program, snapshot, viewedMethodKey],
  );
  const isLive = isCurrentListing(listing, topFrame);

  const deadOffsets =
    listing === undefined || listing.executedOffsets.size === 0
      ? undefined
      : deadOffsetsOf(listing);
  const comments =
    listing === undefined || program === undefined
      ? undefined
      : constantPoolComments(listing, program.classFile);
  const constructs =
    listing === undefined || program === undefined
      ? undefined
      : constructsFor(listing.instructions, program.classFile.constantPool, listing.name);
  const depths = depthsOf(snapshots);
  const timelineEvents = timelineEventsOf(snapshots);
  const sourceLineForOffset =
    listing === undefined
      ? undefined
      : new Map(
          listing.instructions.flatMap((instruction) => {
            const line = lineForOffset(listing, instruction.offset);
            return line === undefined ? [] : [[instruction.offset, line] as const];
          }),
        );

  const sourceLine = snapshot?.sourceLine;
  const pcRange =
    listing === undefined || sourceLine === undefined || !isLive
      ? undefined
      : offsetsForLine(listing, sourceLine);
  const mappingNote =
    listing === undefined || topFrame === undefined || !isLive
      ? undefined
      : lineMappingNote(listing, topFrame.pc);
  const next =
    snapshot === undefined || program === undefined || !isLive
      ? undefined
      : describeNextInstruction(snapshot, listing, program.classFile);
  const operandRoles =
    snapshot === undefined || program === undefined
      ? undefined
      : describeOperandRoles(snapshot, isLive ? listing : undefined, program.classFile);

  const stepForOffset = firstStepByOffset(snapshots, listing);
  const stepForLine = firstStepByLine(snapshots);
  const mnemonicHelp = mnemonicHelpFor(listing);

  const summary = program === undefined ? undefined : runSummaryOf(program);
  const lastLive = lastLiveSnapshot(snapshots);

  const printed = runPrintedOutput(snapshots);
  const consoleLines = printed ? consoleLinesOf(snapshot) : undefined;

  const selectPanel = (panel: PanelName) => {
    setVisiblePanel(panel);
    if (panel === 'source' || panel === 'class') {
      setStructureChoice(panel);
    }
  };

  const selectMethod = (method: MethodListing) => {
    setViewedMethodKey(methodKeyOf(method));
    setLinkedLine(undefined);
    setVisiblePanel('bytecode');
  };

  const runMethod = (method: MethodListing) => {
    if (program === undefined) {
      return;
    }
    void startLoad(`Running ${method.name}`, (context) =>
      runFromState(program, method.name, context),
    );
  };

  const followConstantFromListing = (index: number) => {
    setSelectedConstant(index);
    selectPanel('class');
  };

  const failure = state.status === 'error' ? describeAppError(state.error) : undefined;
  const examplesError = examplesErrorOf(model.examples);
  const examplesFailure = examplesError === undefined ? undefined : describeAppError(examplesError);
  const compileNotice =
    model.compileFailure === undefined ? undefined : describeCompileFailure(model.compileFailure);
  const nextStepLimit =
    state.status === 'error' && state.error.kind === 'step-limit' && program !== undefined
      ? raisedStepLimit(program.maxSteps)
      : undefined;

  const canExplore = program !== undefined && listing !== undefined;
  const canReplay = canExplore && snapshots.length > 0;
  const smoothHighlight = player.speed <= SMOOTH_HIGHLIGHT_UP_TO;
  const structureView: StructureView =
    structureChoice ?? (program?.origin.kind === 'upload' ? 'class' : 'source');

  const compilerIsUsable = compiler === 'online' || compiler === 'degraded';
  const compilerStatus: CompilerStatus =
    compiler === 'online' ? 'online' : compiler === 'degraded' ? 'offline' : 'hidden';
  const writeJava = compilerIsUsable ? openEditor : undefined;

  const raised = compileNotice ?? failure ?? examplesFailure;
  const notice = raised?.message === dismissed ? undefined : raised;
  const dismissNotice = () => {
    setDismissed(raised?.message);
  };

  const structureTabs = (
    <SegmentedControl label="Left panel" className="-my-0.5 p-0.5">
      {STRUCTURE_VIEWS.map(({ id, label, name }) => (
        <Segment
          key={id}
          label={name}
          selected={structureView === id}
          onClick={() => {
            selectPanel(id);
          }}
          className="px-2 py-0.5 text-label"
        >
          {label}
        </Segment>
      ))}
    </SegmentedControl>
  );

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

  const showsWelcome = editor.kind === 'closed' && state.status !== 'loading' && !canExplore;
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
            panelSwitch={canExplore ? { selected: visiblePanel, onSelect: selectPanel } : undefined}
            shortcuts={SHORTCUTS}
          />
        )
      }
      isDropTarget={isDropTarget}
      footer={
        <>
          {!canReplay ? null : (
            <TourStrip
              available={availableTours}
              active={activeTour}
              stopIndex={tourStop}
              onStart={startTour}
              onGoToStop={goToStop}
              onLeave={leaveTour}
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
              stepCount={player.stepCount}
              isPlaying={player.isPlaying}
              speed={player.speed}
              depths={depths}
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
            totalSteps: player.stepCount,
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
            linkedLine={linkedLine}
            onLinkedLineChange={setLinkedLine}
            animateHighlight={smoothHighlight}
            titleControl={structureTabs}
            className={structureVisibilityOf('source', visiblePanel, structureView)}
          />
          <ClassPanel
            classFile={program.classFile}
            methods={program.methods}
            selectedMethod={listing}
            onSelectMethod={selectMethod}
            onRunMethod={runMethod}
            entryMethod={program.entry}
            selectedConstant={selectedConstant}
            onSelectConstant={setSelectedConstant}
            titleControl={structureTabs}
            className={structureVisibilityOf('class', visiblePanel, structureView)}
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
            truncatedAtOffset={listing.truncatedAtOffset}
            next={next}
            help={mnemonicHelp}
            stepForOffset={stepForOffset}
            onSeek={seekTo}
            constantPool={program.classFile.constantPool}
            constructs={constructs}
            sourceLineForOffset={sourceLineForOffset}
            linkedLine={linkedLine}
            onLinkedLineChange={setLinkedLine}
            selectedConstant={selectedConstant}
            onSelectConstant={followConstantFromListing}
            animateHighlight={smoothHighlight}
            isPlaying={player.isPlaying}
            className={visibilityOf('bytecode', visiblePanel)}
          />
          <StateColumn
            frames={snapshot?.callStack ?? NO_FRAMES}
            operandAnnotations={operandRoles}
            heap={snapshot?.heap}
            mnemonic={snapshot?.currentInstruction?.mnemonic}
            lastLiveFrames={lastLive?.callStack}
            summary={summary}
            consoleLines={consoleLines}
            onSeekToStep={seekTo}
            noRunNote={snapshots.length === 0 ? NO_RUN_NOTE : undefined}
            className={`md:col-span-2 lg:col-span-1 ${visibilityOf('state', visiblePanel)}`}
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
