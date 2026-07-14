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

/** Placeholder grid shown while a class file is being fetched, parsed and executed. */
export function LoadingPanels({ label }: { readonly label: string }) {
  return (
    <>
      <SkeletonPanel rows={12}>
        <p role="status" className="sr-only">
          {label}
        </p>
      </SkeletonPanel>
      <SkeletonPanel rows={12} />
      <SkeletonPanel rows={7} raised className="md:col-span-2 lg:col-span-1" />
    </>
  );
}
