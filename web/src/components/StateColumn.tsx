import type { HeapObject, StackFrame } from '../core/interpreter/types';
import type { RunSummary } from '../services/program';

import { CallStackPanel } from './CallStackPanel';
import { CompletionCard } from './CompletionCard';
import { ConsolePanel } from './ConsolePanel';
import { HeapPanel } from './HeapPanel';
import { LocalsPanel } from './LocalsPanel';
import { OperandStackPanel } from './OperandStackPanel';
import { EmptyState, Panel } from './Panel';

interface StateColumnProps {
  readonly frames: readonly StackFrame[];
  readonly operandAnnotations?: readonly (string | undefined)[] | undefined;
  readonly heap?: readonly HeapObject[] | undefined;
  readonly consoleLines?: readonly string[] | undefined;
  readonly mnemonic?: string | undefined;
  readonly lastLiveFrames?: readonly StackFrame[] | undefined;
  readonly summary?: RunSummary | undefined;
  readonly noRunNote?: string | undefined;
  readonly onSeekToStep?: ((step: number) => void) | undefined;
  readonly className?: string;
}

function Hairline() {
  return (
    <div
      aria-hidden="true"
      className="mx-3 h-px shrink-0 bg-line md:mx-0 md:my-3 md:h-auto md:w-px lg:mx-3 lg:my-0 lg:h-px lg:w-auto"
    />
  );
}

const NO_HEAP: readonly HeapObject[] = [];

const SECTION = 'flex min-h-[84px] flex-col md:min-w-0 md:flex-1 lg:flex-initial';

const LAST_SECTION = 'pb-1.5';

function ConsoleSection({ lines }: { readonly lines: readonly string[] }) {
  return (
    <>
      <Hairline />
      <div className={`${SECTION} ${LAST_SECTION}`}>
        <ConsolePanel lines={lines} />
      </div>
    </>
  );
}

export function StateColumn({
  frames,
  operandAnnotations,
  heap = NO_HEAP,
  consoleLines,
  mnemonic,
  lastLiveFrames,
  summary,
  noRunNote,
  onSeekToStep,
  className = '',
}: StateColumnProps) {
  const topFrame = frames.at(-1);
  const topIndex = frames.length - 1;
  const isComplete = summary !== undefined && frames.length === 0;
  const finalFrame = lastLiveFrames?.[0];
  const hasHeap = heap.length > 0;
  const hasConsole = consoleLines !== undefined;

  return (
    <div
      data-testid="state-column"
      className={`flex max-h-full min-h-0 flex-col rounded-panel bg-panel shadow-panel-raised md:flex-row lg:flex-col ${className}`}
    >
      {noRunNote !== undefined ? (
        <div className={`${SECTION} ${LAST_SECTION}`}>
          <Panel title="Run state" meta="no run" variant="state" className="grow">
            <EmptyState status="nothing executed" detail={noRunNote} />
          </Panel>
        </div>
      ) : isComplete ? (
        <>
          <div className={SECTION}>
            <CompletionCard summary={summary} heap={heap} />
          </div>
          <Hairline />
          <div className={`${SECTION} ${hasConsole ? '' : LAST_SECTION}`}>
            <LocalsPanel
              frame={finalFrame}
              frameIndex={0}
              heap={heap}
              caption={`Left behind by ${finalFrame?.methodName ?? 'the entry method'}`}
              onSeekToStep={onSeekToStep}
            />
          </div>
          {consoleLines === undefined ? null : <ConsoleSection lines={consoleLines} />}
        </>
      ) : (
        <>
          <div className={SECTION}>
            <CallStackPanel frames={frames} />
          </div>
          <Hairline />
          <div className={SECTION}>
            <OperandStackPanel
              frame={topFrame}
              frameIndex={topIndex}
              annotations={operandAnnotations}
              heap={heap}
              onSeekToStep={onSeekToStep}
            />
          </div>
          <Hairline />
          <div className={`${SECTION} ${hasHeap || hasConsole ? '' : LAST_SECTION}`}>
            <LocalsPanel
              frame={topFrame}
              frameIndex={topIndex}
              heap={heap}
              onSeekToStep={onSeekToStep}
            />
          </div>
          {hasHeap ? (
            <>
              <Hairline />
              <div className={`${SECTION} ${hasConsole ? '' : LAST_SECTION}`}>
                <HeapPanel heap={heap} frame={topFrame} mnemonic={mnemonic} />
              </div>
            </>
          ) : null}
          {consoleLines === undefined ? null : <ConsoleSection lines={consoleLines} />}
        </>
      )}
    </div>
  );
}
