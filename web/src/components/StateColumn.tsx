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
  /** Frames in contract order: `[0]` is the oldest. */
  readonly frames: readonly StackFrame[];
  readonly operandAnnotations?: readonly (string | undefined)[] | undefined;
  /** Objects of the current snapshot; empty for the runs that only ever hold ints. */
  readonly heap?: readonly HeapObject[] | undefined;
  /**
   * Lines printed up to the current step. Present — even as an empty array — exactly when the
   * run printed something at all; absent when it printed nothing, and then the section does not
   * join the column.
   */
  readonly consoleLines?: readonly string[] | undefined;
  /** Mnemonic of the instruction the current snapshot is about to run. */
  readonly mnemonic?: string | undefined;
  /**
   * Frames of the last snapshot that still had any. On the terminal snapshot the locals of
   * `main` are the run's answer, so they stay on screen instead of blanking.
   */
  readonly lastLiveFrames?: readonly StackFrame[] | undefined;
  /** Present once the run finished — the terminal snapshot shows this instead of empty panels. */
  readonly summary?: RunSummary | undefined;
  /**
   * Why there is no run at all. Present only in the explorer, where a column of panels each
   * saying "no active frame" would describe a run that was never started.
   */
  readonly noRunNote?: string | undefined;
  /**
   * Seek the run to a step. The operand stack and the locals hand it the step that produced a
   * value, so a cell can be followed back to the instruction it came from; omitted, neither
   * panel offers it.
   */
  readonly onSeekToStep?: ((step: number) => void) | undefined;
  readonly className?: string;
}

/**
 * Sections are separated by a hairline that is shorter than the surface, not by a border —
 * hierarchy inside the pane comes from hairlines and from the row fills, never from shadows.
 *
 * On the tablet layout the column lies down as a band under the code panels, so between `md`
 * and `lg` the hairline stands up with it.
 */
function Hairline() {
  return (
    <div
      aria-hidden="true"
      className="mx-3 h-px shrink-0 bg-line md:mx-0 md:my-3 md:h-auto md:w-px lg:mx-3 lg:my-0 lg:h-px lg:w-auto"
    />
  );
}

/** Stable identity, so the panels below never see a new heap on a render that changed nothing. */
const NO_HEAP: readonly HeapObject[] = [];

/**
 * A section is as tall as what it holds, so the room left over in the column goes to whichever
 * one has something to say with it: the call stack while a recursion is deep, the console while
 * a run prints, the heap while a sort runs. None of them grows past its own content — three
 * frames and one local slot are not worth 800px of column.
 *
 * The floor is the explicit minimum rather than `min-h-0`: under pressure the sections shrink
 * and scroll in place, but a section squeezed past its first row states nothing, and the room
 * it gave up is worth less than what it stopped saying.
 *
 * Laid down as a band between `md` and `lg` the sections share the width instead, and there
 * each one fills the height of the band.
 */
const SECTION = 'flex min-h-[84px] flex-col md:min-w-0 md:flex-1 lg:flex-initial';

/** Whichever section ends the column carries the pane's bottom padding. */
const LAST_SECTION = 'pb-1.5';

/**
 * Always the last section of the column, in either branch — the console is the one panel whose
 * content is cumulative, so it reads as the running tail of the column rather than as state
 * competing with the frame above it.
 */
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

/**
 * Sidebar surface holding the state panels. It is a single raised pane: the column itself
 * never scrolls, only the sections inside it do, so the operand stack and the locals stay
 * visible while a deep recursion unwinds. When the sections no longer fit the height, they
 * give way in place and scroll rather than pushing each other past the edge of the pane.
 *
 * The pane fills its cell so the three columns share one baseline — a sidebar stopping in mid
 * air beside two full-height panels reads as a layout that broke, not as one that measured.
 * The sections inside it still size to their content: surplus height collects at the foot of
 * the pane rather than being handed to a section that has nothing to put in it, and scarcity
 * still lands on the sections rather than on the column.
 *
 * The heap joins them only for a program that allocates — and the console only for a run that
 * prints — because otherwise the section would read "no objects" on every step of a program
 * that never allocates one: a permanent fixture saying nothing.
 *
 * At the end of a finished run there are no frames left to describe. Rather than panels all
 * saying "no active frame", the column becomes the payoff: the value the program computed, the
 * arrays it leaves behind, how many instructions it took and how deep it went.
 *
 * Where no run was ever started the same reasoning goes further: there is one thing to say, so
 * the column says it once.
 */
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
          {/* What the program printed is part of what it produced; the payoff keeps it. */}
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
