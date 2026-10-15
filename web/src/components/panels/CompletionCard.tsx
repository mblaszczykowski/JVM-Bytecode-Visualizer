import { NO_EXTERNALS, NO_HEAP, type ExternalValue, type HeapObject } from '../../core/interpreter';
import type { RunSummary } from '../../services/views/program-view';

import { HeapObjectList } from './HeapObjectList';
import { Panel } from './Panel';
import { PANEL_INSET } from '../ui/rhythm';

interface CompletionCardProps {
  readonly summary: RunSummary;
  readonly heap?: readonly HeapObject[] | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
}

interface FigureProps {
  readonly label: string;
  readonly value: string;
}

function Figure({ label, value }: FigureProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-meta text-fg-3">{label}</span>
      <span className="font-mono text-body text-fg tabular-nums">{value}</span>
    </div>
  );
}

export function CompletionCard({
  summary,
  heap = NO_HEAP,
  externals = NO_EXTERNALS,
}: CompletionCardProps) {
  const { resultName, resultValue, totalSteps, maxDepth, reference } = summary;

  return (
    <Panel title="Result" meta="run complete" variant="state" scrolls={false} className="grow">
      <div data-testid="completion-card" className={`pb-1 ${PANEL_INSET}`}>
        <div className="rounded-row bg-accent-wash px-3 py-2.5 shadow-current">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-code text-accent-soft">{resultName}</span>
            <span className="font-mono text-code text-accent-soft">=</span>
            <span
              data-testid="result-value"
              className="font-mono text-display leading-none font-medium text-accent-text tabular-nums"
            >
              {resultValue ?? '–'}
            </span>
          </div>
          {reference?.matches === true ? (
            <p className="mt-1.5 text-micro text-accent-soft">
              Matches the value a real JVM computed for this example when the fixtures were built.
            </p>
          ) : null}
        </div>

        {reference === undefined || reference.matches ? null : (
          <p
            data-testid="reference-mismatch"
            className="mt-2.5 rounded-row bg-warn-wash px-3 py-2.5 text-micro text-warn shadow-banner-warn"
          >
            A real JVM computed {reference.expected} for this example when the fixtures were built;
            this run did not.
          </p>
        )}

        {heap.length === 0 ? null : (
          <div className="mt-2.5 rounded-row bg-raised px-3 py-2.5">
            <p className="pb-2 text-meta text-fg-3">Heap as the run left it</p>
            <HeapObjectList
              heap={heap}
              externals={externals}
              className="scroll-slim flex max-h-[150px] flex-col gap-3 overflow-y-auto"
            />
          </div>
        )}

        <div className="mt-2.5 flex flex-col gap-1.5 rounded-row bg-raised px-3 py-2.5">
          <Figure label="Steps executed" value={totalSteps.toLocaleString('en-US')} />
          <Figure label="Deepest call stack" value={`${String(maxDepth)} frames`} />
        </div>
      </div>
    </Panel>
  );
}
