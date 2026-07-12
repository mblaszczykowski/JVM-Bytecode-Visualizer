import { useState } from 'react';

import { AppShell } from './components/AppShell';
import {
  commentsFor,
  deadOffsetsOf,
  describeNextInstruction,
  describeOperandRoles,
  lineMappingNote,
  methodOf,
  mockDepths,
  offsetsForLine,
} from './components/__fixtures__/mock-derivations';
import {
  mockExamples,
  mockHistory,
  mockMainMethod,
  mockSnapshotAt,
  mockSourceFileName,
  mockSourceLines,
} from './components/__fixtures__/mock-history';
import { BytecodePanel } from './components/BytecodePanel';
import { ErrorBanner } from './components/ErrorBanner';
import { SourcePanel } from './components/SourcePanel';
import { StateColumn } from './components/StateColumn';
import { Toolbar } from './components/Toolbar';
import { TransportControls } from './components/TransportControls';

const APP_NAME = 'JVM Bytecode Visualizer';
const LAST_STEP = mockHistory.length - 1;

function clampStep(index: number): number {
  return Math.min(Math.max(index, 0), LAST_STEP);
}

/**
 * The target layout rendered against the hand-written history in `__fixtures__`.
 * `isPlaying` is purely the visual state of the button — the playback timer arrives with the
 * execution player, which is why there is deliberately no `setInterval` here.
 */
export function App() {
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedExampleId, setSelectedExampleId] = useState('factorial');

  const snapshot = mockSnapshotAt(stepIndex);
  const topFrame = snapshot.callStack.at(-1);
  const method = topFrame === undefined ? mockMainMethod : methodOf(topFrame);

  const comments = commentsFor(method);
  const deadOffsets = deadOffsetsOf(method);

  const pcRange =
    snapshot.sourceLine === undefined ? undefined : offsetsForLine(method, snapshot.sourceLine);
  const mappingNote = topFrame === undefined ? undefined : lineMappingNote(method, topFrame.pc);

  return (
    <AppShell
      toolbar={
        <Toolbar
          appName={APP_NAME}
          examples={mockExamples}
          selectedExampleId={selectedExampleId}
          onExampleSelected={(id) => {
            setSelectedExampleId(id);
            setStepIndex(0);
            setIsPlaying(false);
          }}
          onFileSelected={() => {
            // Reading and validating the file belongs to the upload path, not to this stage.
          }}
          // No compile backend exists yet, so the badge stays out of the toolbar.
          compilerStatus="hidden"
        />
      }
      footer={
        <>
          <div className="px-[18px] pt-[14px]">
            <ErrorBanner
              severity="info"
              message="Demo data — a hand-written execution history of Factorial.factorial(2). The interpreter is not wired up yet."
            />
          </div>
          <TransportControls
            stepIndex={stepIndex}
            stepCount={mockHistory.length}
            isPlaying={isPlaying}
            speed={speed}
            depths={mockDepths}
            onSeek={(index) => {
              setStepIndex(clampStep(index));
            }}
            onTogglePlay={() => {
              setIsPlaying((playing) => !playing);
            }}
            onStepForward={() => {
              setStepIndex((index) => clampStep(index + 1));
            }}
            onStepBack={() => {
              setStepIndex((index) => clampStep(index - 1));
            }}
            onSpeedChange={setSpeed}
          />
        </>
      }
    >
      <SourcePanel
        fileName={mockSourceFileName}
        lines={mockSourceLines}
        currentLine={snapshot.sourceLine}
        pcRange={pcRange}
        lineMappingNote={mappingNote}
      />
      <BytecodePanel
        methodName={method.name}
        methodDescriptor={method.descriptor}
        maxStack={method.maxStack}
        maxLocals={method.maxLocals}
        instructions={method.instructions}
        currentOffset={topFrame?.pc}
        comments={comments}
        deadOffsets={deadOffsets}
        next={describeNextInstruction(snapshot)}
      />
      <StateColumn
        frames={snapshot.callStack}
        operandAnnotations={describeOperandRoles(snapshot)}
        className="md:col-span-2 lg:col-span-1"
      />
    </AppShell>
  );
}
