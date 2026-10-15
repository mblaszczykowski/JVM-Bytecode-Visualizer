import { useState } from 'react';

import {
  NO_EXTERNALS,
  NO_HEAP,
  type ExternalValue,
  type HeapObject,
  type StackFrame,
} from '../../core/interpreter';
import { describeStackEffect } from '../../services/views/bytecode-format';
import { describeValue } from '../../services/views/heap-view';
import type { StackDelta } from '../../services/views/opcode-notes';
import type { RunSummary } from '../../services/views/program-view';

import { CallStackPanel } from './CallStackPanel';
import { CompletionCard } from './CompletionCard';
import { ConsolePanel } from './ConsolePanel';
import { HeapPanel } from './HeapPanel';
import { LocalsPanel } from './LocalsPanel';
import { OperandStackPanel } from './OperandStackPanel';
import { EmptyState, Panel } from './Panel';
import { usePublishedStatus } from '../ui/app-status';
import { Hairline } from '../ui/Hairline';

interface StateColumnProps {
  readonly frames: readonly StackFrame[];
  readonly operandAnnotations?: readonly (string | undefined)[] | undefined;
  readonly heap?: readonly HeapObject[] | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly consoleLines?: readonly string[] | undefined;
  readonly mnemonic?: string | undefined;
  readonly stackEffect?: StackDelta | 'varies' | undefined;
  readonly stepIndex?: number | undefined;
  readonly lastLiveFrames?: readonly StackFrame[] | undefined;
  readonly summary?: RunSummary | undefined;
  readonly noRunNote?: string | undefined;
  readonly isPlaying?: boolean;
  readonly onSeekToStep?: ((step: number) => void) | undefined;
  readonly className?: string;
}

const SEAM = 'mx-3 md:mx-0 md:my-3 md:h-auto md:w-px lg:mx-3 lg:my-0 lg:h-px lg:w-auto';

const SECTION = 'flex min-h-[84px] flex-col md:min-w-0 md:flex-1 lg:flex-initial';

const LAST_SECTION = 'pb-1.5';

const NOTHING_RAN = 'Nothing was executed, so there is no active instruction.';

function describeLocals(
  frame: StackFrame,
  previous: StackFrame | undefined,
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
): readonly string[] {
  return frame.locals.flatMap((value, slot) => {
    const kind = frame.localKinds[slot];
    if (
      value === undefined ||
      kind === undefined ||
      (previous?.locals[slot] === value &&
        previous.localKinds[slot] === kind &&
        previous.localNames[slot] === frame.localNames[slot])
    ) {
      return [];
    }
    const name = frame.localNames[slot] ?? `slot ${String(slot)}`;
    return [`${name} is now ${describeValue(kind, value, heap, externals)}`];
  });
}

function framesDeep(depth: number): string {
  return depth === 1 ? '1 frame deep' : `${String(depth)} frames deep`;
}

function describeState(
  frames: readonly StackFrame[],
  previous: readonly StackFrame[] | undefined,
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
  printed: string | undefined,
): string {
  const frame = frames.at(-1);
  if (frame === undefined) {
    return printed === undefined
      ? 'No frame left; the run has finished.'
      : `No frame left; the run has finished. Printed ${printed}.`;
  }

  const depth = frames.length;
  const previousDepth = previous?.length;
  const parts: string[] = [];
  if (previousDepth === undefined) {
    parts.push(`In ${frame.methodName}`);
  } else if (depth > previousDepth) {
    parts.push(`Called ${frame.methodName}, ${framesDeep(depth)}`);
  } else if (depth < previousDepth) {
    parts.push(`Returned to ${frame.methodName}, ${framesDeep(depth)}`);
  }

  if (previousDepth === undefined || depth >= previousDepth) {
    const against = previousDepth === depth ? previous?.at(-1) : undefined;
    parts.push(...describeLocals(frame, against, heap, externals));
  }

  const top = frame.operandStack.at(-1);
  const topKind = frame.operandKinds.at(-1);
  parts.push(
    top === undefined || topKind === undefined
      ? 'operand stack empty'
      : `operand stack ${String(frame.operandStack.length)} deep, top ${describeValue(
          topKind,
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

function describeInstruction(
  frames: readonly StackFrame[],
  mnemonic: string | undefined,
  stackEffect: StackDelta | 'varies' | undefined,
): string {
  const frame = frames.at(-1);
  if (frame === undefined || mnemonic === undefined) {
    return '';
  }
  const effect = describeStackEffect(stackEffect);
  return `pc ${String(frame.pc)}, ${mnemonic}${effect === undefined ? '' : `, ${effect}`}. `;
}

interface Announced {
  readonly frames: readonly StackFrame[];
  readonly mnemonic: string | undefined;
  readonly printedCount: number;
  readonly text: string;
}

function useStateAnnouncement(
  frames: readonly StackFrame[],
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
  consoleLines: readonly string[] | undefined,
  mnemonic: string | undefined,
  stackEffect: StackDelta | 'varies' | undefined,
): string {
  const printedCount = consoleLines?.length ?? 0;
  const [announced, setAnnounced] = useState<Announced>(() => ({
    frames,
    mnemonic,
    printedCount,
    text:
      describeInstruction(frames, mnemonic, stackEffect) +
      describeState(frames, undefined, heap, externals, undefined),
  }));

  if (
    announced.frames !== frames ||
    announced.mnemonic !== mnemonic ||
    announced.printedCount !== printedCount
  ) {
    const printed = printedCount > announced.printedCount ? consoleLines?.at(-1) : undefined;
    setAnnounced({
      frames,
      mnemonic,
      printedCount,
      text:
        describeInstruction(frames, mnemonic, stackEffect) +
        describeState(frames, announced.frames, heap, externals, printed),
    });
  }

  return announced.text;
}

function ConsoleSection({ lines }: { readonly lines: readonly string[] }) {
  return (
    <>
      <Hairline className={SEAM} />
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
  stackEffect,
  stepIndex,
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
  const announcement = useStateAnnouncement(
    frames,
    heap,
    externals,
    consoleLines,
    mnemonic,
    stackEffect,
  );
  usePublishedStatus(
    noRunNote === undefined ? announcement : NOTHING_RAN,
    isPlaying ? 'off' : 'polite',
  );

  return (
    <div
      data-testid="state-column"
      className={`flex max-h-full min-h-0 flex-col rounded-panel bg-panel shadow-panel-raised md:flex-row lg:flex-col ${className}`}
    >
      {noRunNote !== undefined ? (
        <div className={`${SECTION} ${LAST_SECTION}`}>
          <Panel title="Run state" term="frame" meta="no run" variant="state" className="grow">
            <EmptyState status="nothing executed" detail={noRunNote} />
          </Panel>
        </div>
      ) : isComplete ? (
        <>
          <div className={SECTION}>
            <CompletionCard summary={summary} heap={heap} externals={externals} />
          </div>
          <Hairline className={SEAM} />
          <div className={`${SECTION} ${hasConsole ? '' : LAST_SECTION}`}>
            <LocalsPanel
              frame={finalFrame}
              frameIndex={0}
              stepIndex={stepIndex}
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
            <CallStackPanel frames={frames} heap={heap} externals={externals} />
          </div>
          <Hairline className={SEAM} />
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
          <Hairline className={SEAM} />
          <div className={`${SECTION} ${hasHeap || hasConsole ? '' : LAST_SECTION}`}>
            <LocalsPanel
              frame={topFrame}
              frameIndex={topIndex}
              stepIndex={stepIndex}
              heap={heap}
              externals={externals}
              onSeekToStep={onSeekToStep}
            />
          </div>
          {hasHeap ? (
            <>
              <Hairline className={SEAM} />
              <div className={`${SECTION} ${hasConsole ? '' : LAST_SECTION}`}>
                <HeapPanel
                  heap={heap}
                  frame={topFrame}
                  stepIndex={stepIndex}
                  externals={externals}
                  mnemonic={mnemonic}
                />
              </div>
            </>
          ) : null}
          {consoleLines === undefined ? null : <ConsoleSection lines={consoleLines} />}
        </>
      )}
    </div>
  );
}
