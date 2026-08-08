import type { ReactNode } from 'react';

import { ROW_HEIGHT } from './rhythm';

/**
 * Enough rows to reach past the bottom of a tall panel; the container clips the rest. A count
 * that merely fits the average panel leaves the placeholder floating over an empty half-screen,
 * which is not what the listing about to replace it looks like.
 */
const FILL_ROWS = 44;

interface SkeletonPanelProps {
  /** Shifts the width pattern, so three panels side by side are not the same silhouette. */
  readonly seed: number;
  readonly raised?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

function SkeletonPanel({ seed, raised = false, className = '', children }: SkeletonPanelProps) {
  return (
    <div
      data-testid="panel-skeleton"
      className={`flex min-h-0 flex-col overflow-hidden rounded-panel px-4 py-4 ${
        // The two surfaces of the ready screen, so settling into it does not flash a change:
        // `raised` is the State column, the default is a code panel's ink.
        raised ? 'bg-panel/[0.065] shadow-panel-raised' : 'bg-ink shadow-panel-ink'
      } ${className}`}
    >
      {children}
      {/*
        The fade is on the rows, not on the panel: masking the panel itself would dissolve its
        hairline and its bottom corners along with the last row.
      */}
      <div aria-hidden="true" className="fade-y-end flex min-h-0 flex-1 flex-col gap-1.5">
        {Array.from({ length: FILL_ROWS }, (_, index) => (
          <div
            key={index}
            className="shrink-0 animate-pulse rounded-code bg-raised"
            // Same rhythm as a code row, so the layout does not jump once the run arrives.
            style={{ height: ROW_HEIGHT, width: `${String(42 + (((index + seed) * 17) % 52))}%` }}
          />
        ))}
      </div>
    </div>
  );
}

interface LoadingPanelsProps {
  readonly label: string;
  /** Steps recorded so far; absent while the run is still under way. */
  readonly steps?: number | undefined;
  /** Given only when giving up really ends the run — the label must not promise more. */
  readonly onCancel?: (() => void) | undefined;
}

/**
 * Placeholder grid shown while a class file is being fetched, parsed and executed.
 *
 * The label is announced once and the step count is not: a run at the step-limit ceiling
 * reports its progress a couple of dozen times, which reads as reassurance on screen and as
 * noise through a screen reader, where the label has already said what is happening.
 */
export function LoadingPanels({ label, steps, onCancel }: LoadingPanelsProps) {
  return (
    <>
      <SkeletonPanel seed={0}>
        <div className="flex shrink-0 items-baseline gap-3 pb-2">
          <p role="status" className="grow truncate text-label font-medium text-fg-2">
            {label}
          </p>
          {steps === undefined ? null : (
            <span
              aria-hidden="true"
              data-testid="loading-steps"
              className="shrink-0 font-mono text-meta tabular-nums text-fg-3"
            >
              {steps.toLocaleString('en-US')} steps
            </span>
          )}
          {onCancel === undefined ? null : (
            <button
              type="button"
              onClick={onCancel}
              className="focus-ring shrink-0 rounded-control bg-raised-active px-2.5 py-0.5 text-meta text-fg-2 transition-colors duration-150 hover:bg-raised-active hover:text-fg"
            >
              Cancel
            </button>
          )}
        </div>
      </SkeletonPanel>
      {/* Below 768px the grid has one cell, so only the first skeleton has somewhere to go. */}
      <SkeletonPanel seed={5} className="hidden md:flex" />
      <SkeletonPanel seed={11} raised className="hidden md:col-span-2 md:flex lg:col-span-1" />
    </>
  );
}
