import type { StackFrame } from '../core/interpreter/types';
import type { RunSummary } from '../services/program';

import { CallStackPanel } from './CallStackPanel';
import { CompletionCard } from './CompletionCard';
import { LocalsPanel } from './LocalsPanel';
import { OperandStackPanel } from './OperandStackPanel';

interface StateColumnProps {
  /** Frames in contract order: `[0]` is the oldest. */
  readonly frames: readonly StackFrame[];
  readonly operandAnnotations?: readonly (string | undefined)[] | undefined;
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
 */
function Hairline() {
  return (
    <div
      aria-hidden="true"
      className="mx-[18px] h-px shrink-0 bg-white/9 md:mx-0 md:my-[18px] md:h-auto md:w-px xl:mx-[18px] xl:my-0 xl:h-px xl:w-auto"
    />
  );
}

/**
 * Sidebar surface holding the three state panels. It is a single raised pane: the column
 * itself never scrolls, only the sections inside it do, so the operand stack and the locals
 * stay visible while a deep recursion unwinds.
 *
 * At the end of a finished run there are no frames left to describe. Rather than three panels
 * all saying "no active frame", the column becomes the payoff: the value the program computed,
 * how many instructions it took and how deep it went — next to the locals it was left in.
 */
export function StateColumn({
  frames,
  operandAnnotations,
  lastLiveFrames,
  summary,
  className = '',
}: StateColumnProps) {
  const topFrame = frames.at(-1);
  const topIndex = frames.length - 1;
  const isComplete = summary !== undefined && frames.length === 0;
  const finalFrame = lastLiveFrames?.[0];

  return (
    <div
      data-testid="state-column"
      className={`flex min-h-0 flex-col rounded-panel bg-panel/[0.065] shadow-panel-raised md:flex-row xl:flex-col ${className}`}
    >
      {isComplete ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col">
            <CompletionCard summary={summary} />
          </div>
          <Hairline />
          <div className="flex min-h-0 shrink-0 flex-col pb-[6px] md:flex-1 xl:flex-none">
            <LocalsPanel
              frame={finalFrame}
              frameIndex={0}
              caption={`Left behind by ${finalFrame?.methodName ?? 'the entry method'}`}
            />
          </div>
        </>
      ) : (
        <>
          <CallStackPanel frames={frames} />
          <Hairline />
          <div className="flex min-h-0 shrink-0 flex-col md:flex-1 xl:flex-none">
            <OperandStackPanel
              frame={topFrame}
              frameIndex={topIndex}
              annotations={operandAnnotations}
            />
          </div>
          <Hairline />
          <div className="flex min-h-0 shrink-0 flex-col pb-[6px] md:flex-1 xl:flex-none">
            <LocalsPanel frame={topFrame} frameIndex={topIndex} />
          </div>
        </>
      )}
    </div>
  );
}
