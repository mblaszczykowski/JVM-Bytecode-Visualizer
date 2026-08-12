import { useState } from 'react';

import type { ExternalValue, HeapObject, StackFrame } from '../core/interpreter';
import { describeValue } from '../services/derivations';
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
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly consoleLines?: readonly string[] | undefined;
  readonly mnemonic?: string | undefined;
  readonly lastLiveFrames?: readonly StackFrame[] | undefined;
  readonly summary?: RunSummary | undefined;
  readonly noRunNote?: string | undefined;
  readonly isPlaying?: boolean;
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

const NO_EXTERNALS: readonly ExternalValue[] = [];

const SECTION = 'flex min-h-[84px] flex-col md:min-w-0 md:flex-1 lg:flex-initial';

const LAST_SECTION = 'pb-1.5';

function describeLocals(
  frame: StackFrame,
  previous: StackFrame | undefined,
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
): readonly string[] {
  return frame.locals.flatMap((value, slot) => {
    if (value === undefined || previous?.locals[slot] === value) {
      return [];
    }
    const name = frame.localNames[slot] ?? `slot ${String(slot)}`;
    const label = describeValue(frame.localKinds?.[slot], value, heap, externals);
    return [`${name} is now ${label}`];
  });
}

function describeState(
  frame: StackFrame | undefined,
  previous: StackFrame | undefined,
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
  printed: string | undefined,
): string {
  if (frame === undefined) {
    return printed === undefined
      ? 'No frame left; the run has finished.'
      : `No frame left; the run has finished. Printed ${printed}.`;
  }

  const sameFrame =
    previous?.methodName === frame.methodName &&
    previous.methodDescriptor === frame.methodDescriptor;

  const parts = sameFrame ? [] : [`In ${frame.methodName}`];
  parts.push(...describeLocals(frame, sameFrame ? previous : undefined, heap, externals));

  const top = frame.operandStack.at(-1);
  parts.push(
    top === undefined
      ? 'operand stack empty'
      : `operand stack ${String(frame.operandStack.length)} deep, top ${describeValue(
          frame.operandKinds?.[frame.operandStack.length - 1],
          top,
          heap,
          externals,
        )}`,
  );

  if (printed !== undefined) {
    parts.push(`printed ${printed}`);
  }
  return `${parts.join('; ')}.`;
}

interface Announced {
  readonly frames: readonly StackFrame[];
  readonly printedCount: number;
  readonly text: string;
}

function useStateAnnouncement(
  frames: readonly StackFrame[],
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
  consoleLines: readonly string[] | undefined,
): string {
  const printedCount = consoleLines?.length ?? 0;
  const [announced, setAnnounced] = useState<Announced>(() => ({
    frames,
    printedCount,
    text: describeState(frames.at(-1), undefined, heap, externals, undefined),
  }));

  if (announced.frames !== frames || announced.printedCount !== printedCount) {
    const printed = printedCount > announced.printedCount ? consoleLines?.at(-1) : undefined;
    setAnnounced({
      frames,
      printedCount,
      text: describeState(frames.at(-1), announced.frames.at(-1), heap, externals, printed),
    });
  }

  return announced.text;
}

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
  externals = NO_EXTERNALS,
  consoleLines,
  mnemonic,
  lastLiveFrames,
  summary,
  noRunNote,
  isPlaying = false,
  onSeekToStep,
  className = '',
}: StateColumnProps) {
  const topFrame = frames.at(-1);
  const topIndex = frames.length - 1;
  const isComplete = summary !== undefined && frames.length === 0;
  const finalFrame = lastLiveFrames?.[0];
  const hasHeap = heap.length > 0;
  const hasConsole = consoleLines !== undefined;
  const announcement = useStateAnnouncement(frames, heap, externals, consoleLines);

  return (
    <div
      data-testid="state-column"
      className={`flex max-h-full min-h-0 flex-col rounded-panel bg-panel shadow-panel-raised md:flex-row lg:flex-col ${className}`}
    >
      {noRunNote === undefined ? (
        <p
          data-testid="state-announcement"
          className="sr-only"
          aria-live={isPlaying ? 'off' : 'polite'}
        >
          {announcement}
        </p>
      ) : null}

      {noRunNote !== undefined ? (
        <div className={`${SECTION} ${LAST_SECTION}`}>
          <Panel title="Run state" meta="no run" variant="state" className="grow">
            <EmptyState status="nothing executed" detail={noRunNote} />
          </Panel>
        </div>
      ) : isComplete ? (
        <>
          <div className={SECTION}>
            <CompletionCard summary={summary} heap={heap} externals={externals} />
          </div>
          <Hairline />
          <div className={`${SECTION} ${hasConsole ? '' : LAST_SECTION}`}>
            <LocalsPanel
              frame={finalFrame}
              frameIndex={0}
              heap={heap}
              externals={externals}
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
              externals={externals}
              onSeekToStep={onSeekToStep}
            />
          </div>
          <Hairline />
          <div className={`${SECTION} ${hasHeap || hasConsole ? '' : LAST_SECTION}`}>
            <LocalsPanel
              frame={topFrame}
              frameIndex={topIndex}
              heap={heap}
              externals={externals}
              onSeekToStep={onSeekToStep}
            />
          </div>
          {hasHeap ? (
            <>
              <Hairline />
              <div className={`${SECTION} ${hasConsole ? '' : LAST_SECTION}`}>
                <HeapPanel heap={heap} frame={topFrame} externals={externals} mnemonic={mnemonic} />
              </div>
            </>
          ) : null}
          {consoleLines === undefined ? null : <ConsoleSection lines={consoleLines} />}
        </>
      )}
    </div>
  );
}
