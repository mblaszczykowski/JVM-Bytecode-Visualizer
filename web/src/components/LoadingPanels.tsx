import type { ReactNode } from 'react';

import { ROW_HEIGHT } from './rhythm';

interface SkeletonPanelProps {
  readonly rows: number;
  readonly raised?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}

function SkeletonPanel({ rows, raised = false, className = '', children }: SkeletonPanelProps) {
  return (
    <div
      data-testid="panel-skeleton"
      className={`flex min-h-0 flex-col gap-[6px] overflow-hidden rounded-panel px-[18px] py-[16px] ${
        raised ? 'bg-panel/[0.065] shadow-panel-raised' : 'bg-panel/[0.045] shadow-panel'
      } ${className}`}
    >
      {children}
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="shrink-0 animate-pulse rounded-code bg-white/5"
          // Same rhythm as a code row, so the layout does not jump once the run arrives.
          style={{ height: ROW_HEIGHT, width: `${String(45 + ((index * 17) % 50))}%` }}
        />
      ))}
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
      <SkeletonPanel rows={11}>
        <div className="flex shrink-0 items-baseline gap-3 pb-[4px]">
          <p role="status" className="grow truncate text-[11.5px] text-white/55">
            {label}
          </p>
          {steps === undefined ? null : (
            <span
              aria-hidden="true"
              data-testid="loading-steps"
              className="shrink-0 text-[11px] tabular-nums text-white/35"
            >
              {steps.toLocaleString('en-US')} steps
            </span>
          )}
          {onCancel === undefined ? null : (
            <button
              type="button"
              onClick={onCancel}
              className="focus-ring shrink-0 rounded-full bg-white/10 px-[10px] py-[3px] text-[11px] hover:bg-white/20"
            >
              Cancel
            </button>
          )}
        </div>
      </SkeletonPanel>
      {/* Below 768px the grid has one cell, so only the first skeleton has somewhere to go. */}
      <SkeletonPanel rows={12} className="hidden md:flex" />
      <SkeletonPanel rows={7} raised className="hidden md:col-span-2 md:flex lg:col-span-1" />
    </>
  );
}
