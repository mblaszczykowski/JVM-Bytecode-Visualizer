import { useState } from 'react';

import {
  findMockMethod,
  mockExamples,
  mockHistory,
  mockMainMethod,
  mockSnapshotAt,
  mockSourceFileName,
  mockSourceLines,
} from './components/__fixtures__/mock-history';
import { BytecodePanel } from './components/BytecodePanel';
import { CallStackPanel } from './components/CallStackPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { ExamplePicker } from './components/ExamplePicker';
import { FileUpload } from './components/FileUpload';
import { LocalsPanel } from './components/LocalsPanel';
import { OperandStackPanel } from './components/OperandStackPanel';
import { SourcePanel } from './components/SourcePanel';
import { AMBIENT_BACKGROUND, SHELL } from './components/theme';
import { TransportControls } from './components/TransportControls';

const LAST_STEP = mockHistory.length - 1;

function clampStep(index: number): number {
  return Math.min(Math.max(index, 0), LAST_STEP);
}

/**
 * Faza 5 (plan §9): docelowy layout renderowany na zahardkodowanej historii z `__fixtures__`.
 * Zamiana mocka na `execute()` i timer odtwarzania to Faza 6 (`useExecutionPlayer`) — dlatego
 * `isPlaying` jest tu wyłącznie stanem wizualnym przycisku, bez `setInterval`.
 */
export function App() {
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectedExampleId, setSelectedExampleId] = useState('factorial');

  const snapshot = mockSnapshotAt(stepIndex);
  const topFrame = snapshot.callStack.at(-1);
  const method =
    topFrame === undefined
      ? mockMainMethod
      : (findMockMethod(topFrame.methodName, topFrame.methodDescriptor) ?? mockMainMethod);

  return (
    <div
      className="h-dvh bg-[#0b0d13] p-3 text-slate-100 sm:p-[14px]"
      style={{ backgroundImage: AMBIENT_BACKGROUND, backgroundAttachment: 'fixed' }}
    >
      <div className={`flex h-full min-h-0 flex-col ${SHELL}`}>
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-[18px] py-[13px]">
          <h1 className="text-[13.5px] font-semibold tracking-[-0.015em] text-white/95">
            JVM Bytecode Visualizer
          </h1>
          <ExamplePicker
            examples={mockExamples}
            selectedId={selectedExampleId}
            onExampleSelected={(id) => {
              setSelectedExampleId(id);
              setStepIndex(0);
              setIsPlaying(false);
            }}
          />
          <div className="ml-auto">
            <FileUpload
              onFileSelected={() => {
                // Wczytywanie i walidacja pliku to Faza 7 — w Fazie 5 komponent jest stubem.
              }}
            />
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-[14px] px-[14px] md:grid-cols-2 xl:grid-cols-[1fr_1fr_340px]">
          <SourcePanel
            fileName={mockSourceFileName}
            lines={mockSourceLines}
            currentLine={snapshot.sourceLine}
          />
          <BytecodePanel
            methodName={method.name}
            methodDescriptor={method.descriptor}
            instructions={method.instructions}
            currentOffset={topFrame?.pc}
          />
          <div className="flex min-h-0 flex-col gap-[14px] md:col-span-2 md:flex-row xl:col-span-1 xl:flex-col">
            <CallStackPanel frames={snapshot.callStack} />
            <OperandStackPanel frame={topFrame} />
            <LocalsPanel frame={topFrame} />
          </div>
        </main>

        <footer className="shrink-0">
          <div className="px-[18px] pt-[14px]">
            <ErrorBanner
              severity="info"
              message="Dane demonstracyjne: ręcznie zbudowana historia wykonania Factorial.factorial(2). Prawdziwy interpreter podłączamy w Fazie 6."
            />
          </div>
          <TransportControls
            stepIndex={stepIndex}
            stepCount={mockHistory.length}
            isPlaying={isPlaying}
            speed={speed}
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
        </footer>
      </div>
    </div>
  );
}
