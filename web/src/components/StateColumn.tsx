import type { StackFrame } from '../core/interpreter/types';

import { CallStackPanel } from './CallStackPanel';
import { LocalsPanel } from './LocalsPanel';
import { OperandStackPanel } from './OperandStackPanel';

interface StateColumnProps {
  /** Frames in contract order: `[0]` is the oldest. */
  readonly frames: readonly StackFrame[];
  readonly operandAnnotations?: readonly (string | undefined)[] | undefined;
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
 * itself never scrolls, only the frame list inside it does, so the operand stack and the
 * locals stay visible while a deep recursion unwinds.
 */
export function StateColumn({ frames, operandAnnotations, className = '' }: StateColumnProps) {
  const topFrame = frames.at(-1);
  const topIndex = frames.length - 1;

  return (
    <div
      data-testid="state-column"
      className={`flex min-h-0 flex-col rounded-panel bg-panel/[0.065] shadow-panel-raised md:flex-row xl:flex-col ${className}`}
    >
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
    </div>
  );
}
