import type { ReactNode } from 'react';

import { ROW_HEIGHT } from './rhythm';
import { Button } from './ui/Button';

const FILL_ROWS = 44;

interface SkeletonPanelProps {
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
        raised ? 'bg-panel shadow-panel-raised' : 'bg-ink shadow-panel-ink'
      } ${className}`}
    >
      {children}
      <div aria-hidden="true" className="fade-y-end flex min-h-0 flex-1 flex-col gap-1.5">
        {Array.from({ length: FILL_ROWS }, (_, index) => (
          <div
            key={index}
            className="shrink-0 rounded-code bg-raised motion-safe:animate-pulse"
            style={{ height: ROW_HEIGHT, width: `${String(42 + (((index + seed) * 17) % 52))}%` }}
          />
        ))}
      </div>
    </div>
  );
}

interface LoadingPanelsProps {
  readonly label: string;
  readonly steps?: number | undefined;
  readonly onCancel?: (() => void) | undefined;
}

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
            <Button tone="nested" size="sm" onClick={onCancel} className="shrink-0">
              Cancel
            </Button>
          )}
        </div>
      </SkeletonPanel>
      <SkeletonPanel seed={5} className="hidden md:flex" />
      <SkeletonPanel seed={11} raised className="hidden md:col-span-2 md:flex lg:col-span-1" />
    </>
  );
}
