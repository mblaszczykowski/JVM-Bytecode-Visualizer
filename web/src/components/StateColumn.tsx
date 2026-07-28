import type { ArrayObject, StackFrame } from '../core/interpreter/types';
import type { RunSummary } from '../services/program';

import { CallStackPanel } from './CallStackPanel';
import { CompletionCard } from './CompletionCard';
import { HeapPanel } from './HeapPanel';
import { LocalsPanel } from './LocalsPanel';
import { OperandStackPanel } from './OperandStackPanel';

interface StateColumnProps {
  /** Frames in contract order: `[0]` is the oldest. */
  readonly frames: readonly StackFrame[];
  readonly operandAnnotations?: readonly (string | undefined)[] | undefined;
  /** Objects of the current snapshot; empty for the runs that only ever hold ints. */
  readonly heap?: readonly ArrayObject[] | undefined;
  /** Mnemonic of the instruction the current snapshot is about to run. */
  readonly mnemonic?: string | undefined;
  /**
   * Frames of the last snapshot that still had any. On the terminal snapshot the locals of
   * `main` are the run's answer, so they stay on screen instead of blanking.
   */
  readonly lastLiveFrames?: readonly StackFrame[] | undefined;
  /** Present once the run finished — the terminal snapshot shows this instead of empty panels. */
  readonly summary?: RunSummary | undefined;
  readonly className?: string;
}

/**
 * Sections are separated by a hairline that is shorter than the surface, not by a border —
 * hierarchy inside the glass comes from background opacity and hairlines, never from shadows.
 *
 * On the tablet layout the column lies down as a band under the code panels, so between `md`
 * and `lg` the hairline stands up with it.
 */
function Hairline() {
  return (
    <div
      aria-hidden="true"
      className="mx-[18px] h-px shrink-0 bg-white/9 md:mx-0 md:my-[18px] md:h-auto md:w-px lg:mx-[18px] lg:my-0 lg:h-px lg:w-auto"
    />
  );
}

/** Stable identity, so the panels below never see a new heap on a render that changed nothing. */
const NO_HEAP: readonly ArrayObject[] = [];

/**
 * Sidebar surface holding the state panels. It is a single raised pane: the column itself
 * never scrolls, only the sections inside it do, so the operand stack and the locals stay
 * visible while a deep recursion unwinds. When four sections no longer fit the height, they
 * give way in place and scroll rather than pushing each other past the edge of the pane.
 *
 * The heap joins them only for a program that allocates: the four int-only examples have
 * nothing to put in it, and a section reading "no objects" on every one of their steps would
 * be a permanent fixture saying nothing.
 *
 * At the end of a finished run there are no frames left to describe. Rather than panels all
 * saying "no active frame", the column becomes the payoff: the value the program computed, the
 * arrays it leaves behind, how many instructions it took and how deep it went.
 */
export function StateColumn({
  frames,
  operandAnnotations,
  heap = NO_HEAP,
  mnemonic,
  lastLiveFrames,
  summary,
  className = '',
}: StateColumnProps) {
  const topFrame = frames.at(-1);
  const topIndex = frames.length - 1;
  const isComplete = summary !== undefined && frames.length === 0;
  const finalFrame = lastLiveFrames?.[0];
  const hasHeap = heap.length > 0;

  return (
    <div
      data-testid="state-column"
      className={`flex min-h-0 flex-col rounded-panel bg-panel/[0.065] shadow-panel-raised md:flex-row lg:flex-col ${className}`}
    >
      {isComplete ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <CompletionCard summary={summary} heap={heap} />
          </div>
          <Hairline />
          <div className="flex min-h-0 flex-col pb-[6px] md:min-w-0 md:flex-1 lg:flex-initial">
            <LocalsPanel
              frame={finalFrame}
              frameIndex={0}
              heap={heap}
              caption={`Left behind by ${finalFrame?.methodName ?? 'the entry method'}`}
            />
          </div>
        </>
      ) : (
        <>
          <CallStackPanel frames={frames} />
          <Hairline />
          <div className="flex min-h-0 flex-col md:min-w-0 md:flex-1 lg:flex-initial">
            <OperandStackPanel
              frame={topFrame}
              frameIndex={topIndex}
              annotations={operandAnnotations}
              heap={heap}
            />
          </div>
          <Hairline />
          <div
            className={`flex min-h-0 flex-col md:min-w-0 md:flex-1 lg:flex-initial ${
              hasHeap ? '' : 'pb-[6px]'
            }`}
          >
            <LocalsPanel frame={topFrame} frameIndex={topIndex} heap={heap} />
          </div>
          {hasHeap ? (
            <>
              <Hairline />
              <div className="flex min-h-0 flex-col pb-[6px] md:min-w-0 md:flex-1 lg:flex-initial">
                <HeapPanel heap={heap} frame={topFrame} mnemonic={mnemonic} />
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
