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

/**
 * The screen: everything below is derived from the reducer model and the transport position,
 * and it is written as plain derivation. The React Compiler (see `vite.config.ts`) caches every
 * value and every handler here, so a `useMemo` around one of them would only restate the build.
 * The two exceptions are deliberate: the empty constants below, which the compiler cannot
 * invent because an empty literal is written fresh each render, and the `useMemo` on `listing`.
 */

const APP_NAME = 'JVM Bytecode Visualizer';

/** Stable empty history: a fresh array every render would keep rewinding the player. */
const NO_SNAPSHOTS: readonly Snapshot[] = [];

const NO_DIAGNOSTICS: readonly CompileDiagnostic[] = [];

/** Same reason as the other empty constants: a fresh `[]` prop is a new value every render. */
const NO_TOURS: readonly Tour[] = [];

/** Same reason as NO_SNAPSHOTS: a literal `[]` prop is a new value on every render. */
const NO_FRAMES: readonly StackFrame[] = [];

/** Above 4× the highlight changes rows faster than the projection can read as movement. */
const SMOOTH_HIGHLIGHT_UP_TO = 4;

/**
 * Stands in for the run state when there is no run. The banner carries the reason; this only
 * has to explain why three panels that normally describe a frame have nothing in them.
 */
const NO_RUN_NOTE =
  'Nothing was executed, so there is no frame, no operand stack and no locals to describe. ' +
  'The class file is on the left and its listings are in the middle.';

/**
 * Written here rather than inside the sheet, so the list is next to the `useTransportShortcuts`
 * call that installs it and cannot quietly describe handlers that are no longer bound.
 */
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

/**
 * What a crash report is allowed to say about the loaded program.
 *
 * A bundled example is named, because it is ours and its id replays the run exactly. Anything
 * the reader brought is a kind and a rounded size — the file name, the class name and the
 * bytes stay in the tab, which is the promise the README makes about an upload.
 */
function telemetryContextOf(program: LoadedProgram): ProgramContext {
  const { origin } = program;
  switch (origin.kind) {
    case 'example':
      return { origin: 'example', exampleId: origin.entry.id };
    case 'upload':
      return { origin: 'upload', methods: program.methods.length };
    case 'compiled':
      // The source is the reader's own and was typed into this tab; only the fact that it was
      // compiled here travels.
      return { origin: 'compiled', methods: program.methods.length };
  }
}

/** Below 768px the grid holds one panel; everywhere else all three columns are on screen. */
function visibilityOf(panel: PanelName, selected: PanelName): string {
  return panel === selected ? '' : 'hidden md:flex';
}

/**
 * The left column carries two panels over one grid cell — the `.java` that was compiled and
 * the class file it was compiled into. Below 768px the toolbar switch owns the cell outright;
 * above it, the column's own tab decides which of the two is on screen.
 */
function structureVisibilityOf(
  panel: StructureView,
  selected: PanelName,
  shown: StructureView,
): string {
  return `${panel === selected ? '' : 'hidden'} ${panel === shown ? 'md:flex' : 'md:hidden'}`;
}

/**
 * One explanation per mnemonic in the listing, not per row: a loop body that runs `iload` forty
 * times asks the same question forty times, and the panel looks the answer up by mnemonic.
 */
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

/** The two faces of the left column: the `.java` it came from, and the `.class` itself. */
type StructureView = 'source' | 'class';

/**
 * The accessible name says more than the tab does, and deliberately differs from the toolbar's
 * `Source` / `Class` — those switch the whole grid on a phone, these switch one column.
 */
const STRUCTURE_VIEWS: readonly {
  readonly id: StructureView;
  readonly label: string;
  readonly name: string;
}[] = [
  { id: 'source', label: 'Source', name: 'Source — the Java this class was compiled from' },
  { id: 'class', label: 'Class', name: 'Class — the structure of the class file itself' },
];

/**
 * The single place a load may throw: every path into the grid comes through here, so a
 * failure ends as a banner rather than as a skeleton that never goes away.
 *
 * `undefined` for a run the reader gave up on. That is not an outcome and has no state —
 * `load-cancelled` put the previous screen back the moment they asked, and the answer this
 * load would have produced no longer belongs anywhere.
 */
async function settle(load: () => Promise<AppState>): Promise<AppState | undefined> {
  try {
    return await load();
  } catch (error) {
    return isRunCancelled(error) ? undefined : failedState(toAppError(error));
  }
}

interface AppProps {
  /** Base URL of the compile service; `undefined` switches the editor off (ADR-0004). */
  readonly compileApiUrl?: string | undefined;
  /**
   * Where programs are executed. Injected for the same reason as `compileApiUrl`: the default
   * needs a `Worker`, which neither jsdom nor Node has, and a test that wants to watch a load
   * mid-flight needs to hold the run open rather than race a real thread.
   */
  readonly programRunner?: ProgramRunner | undefined;
}

export function App({
  compileApiUrl = compileApiBaseUrl(),
  programRunner = defaultProgramRunner(),
}: AppProps = {}) {
  const [model, dispatch] = useReducer(appReducer, compileApiUrl !== undefined, initialAppModel);
  const { editor, compiler } = model;
  const state = model.load;
  /** Kept outside the model so closing and reopening the editor does not throw the draft away. */
  const [draft, setDraft] = useState(SEED_SOURCE);
  const [visiblePanel, setVisiblePanel] = useState<PanelName>('bytecode');
  /** Which face of the left column the reader asked for; until then it answers for itself. */
  const [structureChoice, setStructureChoice] = useState<StructureView | undefined>(undefined);
  /** Method whose listing is being read, when it is not the one the run is standing in. */
  const [viewedMethodKey, setViewedMethodKey] = useState<string | undefined>(undefined);
  /** Constant pool entry the reader is following, from either side of the cross-link. */
  const [selectedConstant, setSelectedConstant] = useState<number | undefined>(undefined);
  /**
   * Source line the pointer or the keyboard is resting on, from either panel. One value drives
   * both directions: the listing translates a row to its line before reporting it, so hovering
   * an instruction marks every instruction of that line and the line itself.
   */
  const [linkedLine, setLinkedLine] = useState<number | undefined>(undefined);
  /** Message of the banner the reader closed, so the same one does not come straight back. */
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);

  const tokenRef = useRef(0);
  const issueToken = (): number => {
    tokenRef.current += 1;
    return tokenRef.current;
  };

  /**
   * The hash as it was when the page opened. Read once: from here on the hash is something this
   * component writes, and re-reading it would fight the transport for the position.
   */
  const [openedAt] = useState(() => parseDeepLink(window.location.hash));
  /**
   * Read once, like the hash: how the page is being shown does not change while it is open, and
   * an embed that could turn itself back into the full application would be a surprise.
   */
  const [embedded] = useState(() => isEmbedded(window.location.search));
  /** Both halves of the link are honoured once — the example, then the step inside its run. */
  const pendingExample = useRef(openedAt?.exampleId);
  const pendingStep = useRef(openedAt?.stepIndex);
  const pendingTour = useRef(openedAt?.tour);
  /** The tour being walked, if any, and where in it. */
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

  /**
   * Only the most recent load may land: a slow example must not overwrite a newer upload.
   *
   * The token settles which answer counts; the controller settles which run continues. They
   * are separate on purpose — a run this application has stopped caring about is not the same
   * thing as a run it has stopped, and only a worker can do the second.
   */
  const running = useRef<AbortController | undefined>(undefined);
  const startLoad = async (
    label: string,
    load: (context: LoadContext) => Promise<AppState>,
  ): Promise<void> => {
    const token = issueToken();
    // Whatever was still executing belongs to a screen the reader has already left.
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;

    dispatch({ kind: 'load-started', token, label, cancellable: programRunner.cancellable });
    // Everywhere the reader had navigated to belongs to the program they are leaving.
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

  /** Ends the run and puts back whatever the load replaced — see `load-cancelled`. */
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

  /**
   * A link opens on the program it names instead of on the welcome screen. It waits for the
   * manifest, because until then there is no entry to load; an id the manifest does not carry
   * is simply dropped, and the reader gets the ordinary first screen.
   *
   * An embed with no program named is the one case that picks for itself. A frame in someone
   * else's page has no business showing a chooser — whoever wrote the embed already chose, and
   * if they chose nothing the frame should still be a run rather than an invitation.
   */
  useEffect(() => {
    const id = pendingExample.current ?? (embedded ? examples[0]?.id : undefined);
    if (id === undefined || examples.length === 0) {
      return;
    }
    pendingExample.current = undefined;
    selectExample(id);
    // `selectExample` closes over the freshly loaded `examples`, which is what gates this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examples, embedded]);

  const selectFile = (file: File) => {
    void startLoad(`Reading ${file.name}`, (context) => loadUploadState(file, undefined, context));
  };

  // Without this a file dropped anywhere but the small zone navigates the tab away from the
  // app, taking the loaded run with it.
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
      // The editor closed, a program was loaded or a newer compile was issued meanwhile.
      return;
    }
    dispatch({ kind: 'compile-settled', token, result });

    if (result.kind === 'compiled') {
      // `startLoad` closes the editor; the visualization is the answer to the compile.
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

  /**
   * Only a bundled example can be addressed: an uploaded `.class` never leaves the tab, so a
   * link to one would open an empty screen for whoever followed it.
   */
  const loadedExampleId = program?.origin.kind === 'example' ? program.origin.entry.id : undefined;

  /**
   * A shared link names a step of a run that does not exist until the class file has been
   * fetched, parsed and executed, so the position is applied once — when the history it points
   * into is finally there. A step past the end of that history is dropped rather than clamped:
   * the link is about a specific moment, and the last step is not it.
   */
  useEffect(() => {
    const step = pendingStep.current;
    if (step === undefined || stepCount === 0) {
      return;
    }
    pendingStep.current = undefined;
    // The reader may have picked something else while the linked example was still loading.
    if (loadedExampleId === openedAt?.exampleId && step < stepCount) {
      seekTo(step);
    }
  }, [loadedExampleId, openedAt, stepCount, seekTo]);

  const availableTours = loadedExampleId === undefined ? NO_TOURS : toursFor(loadedExampleId);
  /**
   * Stops become steps only once the run exists, and a stop that no longer resolves is dropped
   * by `resolveTour` — so a tour with nothing left to point at is not a tour.
   */
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

  /** Walking to a stop is seeking; the strip is a second way to drive the same transport. */
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

  // A tour named in the link waits for its run exactly as a step does.
  useEffect(() => {
    const link = pendingTour.current;
    if (link === undefined || stepCount === 0 || loadedExampleId !== openedAt?.exampleId) {
      return;
    }
    pendingTour.current = undefined;
    setTourId(link.tourId);
    setTourStop(link.stopIndex);
  }, [loadedExampleId, openedAt, stepCount]);

  // Entering a tour, or arriving on one from a link, puts the run on the stop being read.
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
    // While a tour is being walked the hash names the tour, not the step: what is worth sharing
    // is the argument, and the step is wherever the argument currently stands.
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
  /**
   * The listing on screen: the method the reader opened in the picker, or — until they open
   * one — whichever method the run is standing in. A class with no run still has a listing,
   * so this is where browsing takes over from replaying.
   *
   * The one hand-written memo here, and not for its own cost — `listingToShow` is a lookup.
   * Half the derivations below take `listing`, and handing it out from an unmemoised call
   * leaves the React Compiler unable to bound when it may change, so it caches none of them —
   * including `firstStepByOffset`, which walks the whole history and would walk it again on
   * every frame of playback. Memoised here, the compiler caches the lot.
   */
  const listing = useMemo(
    () => (program === undefined ? undefined : listingToShow(program, snapshot, viewedMethodKey)),
    [program, snapshot, viewedMethodKey],
  );
  /** Whether the step and the listing are talking about the same method (see the service). */
  const isLive = isCurrentListing(listing, topFrame);

  // Dimming every row of a method the run never entered would report the whole listing as
  // dead code, when the truth is that this run never had an opinion about it.
  const deadOffsets =
    listing === undefined || listing.executedOffsets.size === 0
      ? undefined
      : deadOffsetsOf(listing);
  const comments =
    listing === undefined || program === undefined
      ? undefined
      : constantPoolComments(listing, program.classFile);
  /** What javac was compiling, per offset — javac's habits, so it lives beside the listing. */
  const constructs =
    listing === undefined || program === undefined
      ? undefined
      : constructsFor(listing.instructions, program.classFile.constantPool, listing.name);
  const depths = depthsOf(snapshots);
  const timelineEvents = timelineEventsOf(snapshots);
  /**
   * The listing's half of the source link: the line each instruction was compiled from, so the
   * bytecode panel can report a hovered row as a line without App having to map anything back.
   */
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
  // The "Next" card and the operand roles read the current instruction against the listing;
  // pointed at another method they would describe an instruction that is not about to run.
  const next =
    snapshot === undefined || program === undefined || !isLive
      ? undefined
      : describeNextInstruction(snapshot, listing, program.classFile);
  const operandRoles =
    snapshot === undefined || program === undefined
      ? undefined
      : describeOperandRoles(snapshot, isLive ? listing : undefined, program.classFile);

  // Click-to-seek: both code panels know their rows by offset and by line, so the run is
  // indexed both ways.
  const stepForOffset = firstStepByOffset(snapshots, listing);
  const stepForLine = firstStepByLine(snapshots);
  const mnemonicHelp = mnemonicHelpFor(listing);

  const summary = program === undefined ? undefined : runSummaryOf(program);
  const lastLive = lastLiveSnapshot(snapshots);

  // The Console section joins the column for a run that printed, and stays for the rest of
  // it — the same rule the heap follows. A build whose interpreter has no console yet simply
  // never satisfies it. Kept a step apart from the lines themselves, which change every step:
  // folded into one expression, this scan of the whole history would run again each of them.
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
    // A line number belongs to the listing it was read from; the next one numbers its own.
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

  /**
   * Following a `#n` out of the listing opens the pool at that entry — on a phone that means
   * bringing the Class panel to the front, since only one panel holds the cell there. The
   * other direction needs no such move: a pool row marks its instructions where they already
   * are, and on a phone the toolbar switch is one tap away.
   */
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

  /**
   * A parsed class file is worth showing whether or not it ran: the grid opens on the program,
   * and the transport joins it only when there is a recording to move through.
   */
  const canExplore = program !== undefined && listing !== undefined;
  const canReplay = canExplore && snapshots.length > 0;
  const smoothHighlight = player.speed <= SMOOTH_HIGHLIGHT_UP_TO;
  // Until the reader picks a side, the column shows the source — unless there is none, and an
  // uploaded `.class` arriving without its `.java` is exactly when the structure is the story.
  const structureView: StructureView =
    structureChoice ?? (program?.origin.kind === 'upload' ? 'class' : 'source');

  const compilerIsUsable = compiler === 'online' || compiler === 'degraded';
  const compilerStatus: CompilerStatus =
    compiler === 'online' ? 'online' : compiler === 'degraded' ? 'offline' : 'hidden';
  const writeJava = compilerIsUsable ? openEditor : undefined;

  // The compile attempt is the newer event, so its banner wins over a stale run failure;
  // examples that never arrived are the oldest news of the three.
  const raised = compileNotice ?? failure ?? examplesFailure;
  // A message stays dismissed until a different one takes its place — no effect needed, the
  // text of the current notice is the identity of the current notice.
  const notice = raised?.message === dismissed ? undefined : raised;
  const dismissNotice = () => {
    setDismissed(raised?.message);
  };

  /**
   * The left column's own header is the switch between its two panels — the tab strip has no
   * surface of its own, so nothing new floats on the glass and the column keeps one frame.
   */
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

  /**
   * A failed upload belongs next to the drop zone that caused it, not 500px away at the foot
   * of the shell. Once there is a run on screen the grid owns that space, so a run failure
   * goes back to the footer, right above the transport it still applies to.
   */
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
