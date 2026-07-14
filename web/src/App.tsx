import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from './components/AppShell';
import { BytecodePanel } from './components/BytecodePanel';
import { ErrorBanner } from './components/ErrorBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { ExampleOption } from './components/ExamplePicker';
import { LoadingPanels } from './components/LoadingPanels';
import { SourcePanel } from './components/SourcePanel';
import { StateColumn } from './components/StateColumn';
import { Toolbar } from './components/Toolbar';
import { TransportControls } from './components/TransportControls';
import { WelcomeScreen, type WelcomeExample } from './components/WelcomeScreen';
import type { Snapshot } from './core/interpreter';
import { useExecutionPlayer } from './hooks/useExecutionPlayer';
import { useTransportShortcuts } from './hooks/useTransportShortcuts';
import {
  failedState,
  IDLE,
  loadExampleState,
  loadingState,
  loadUploadState,
  programOf,
  raisedStepLimit,
  rerunState,
  type AppState,
} from './services/app-state';
import {
  constantPoolComments,
  describeNextInstruction,
  describeOperandRoles,
} from './services/derivations';
import { describeAppError, toAppError } from './services/errors';
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

export function App() {
  const [state, setState] = useState<AppState>(IDLE);
  const [examples, setExamples] = useState<readonly ExampleEntry[]>([]);
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

  /** Only the most recent load may land: a slow example must not overwrite a newer upload. */
  const startLoad = useCallback(
    async (label: string, load: () => Promise<AppState> | AppState): Promise<void> => {
      loadCounter.current += 1;
      const token = loadCounter.current;
      setState(loadingState(label));

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
          // No compile backend is configured yet, so the badge stays out of the toolbar.
          compilerStatus="hidden"
        />
      }
      footer={
        <>
          {failure === undefined ? null : (
            <div className="px-[18px] pt-[14px]">
              <ErrorBanner
                severity={failure.severity}
                message={failure.message}
                action={
                  nextStepLimit === undefined || program === undefined
                    ? undefined
                    : {
                        label: 'Raise the limit',
                        onAction: () => {
                          void startLoad(
                            `Re-running with ${nextStepLimit.toLocaleString('en-US')} steps`,
                            () => rerunState(program, nextStepLimit),
                          );
                        },
                      }
                }
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
      {state.status === 'loading' ? (
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
        />
      )}
    </AppShell>
  );
}
