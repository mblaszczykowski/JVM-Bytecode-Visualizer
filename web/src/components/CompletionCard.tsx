import type { ExternalValue, HeapObject } from '../core/interpreter';
import type { RunSummary } from '../services/program';

import { NO_EXTERNALS, NO_HEAP } from './empty';
import { HeapArrayRow, HeapInstanceRow } from './HeapRows';
import { Panel } from './Panel';

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
  const { resultName, resultValue, totalSteps, maxDepth, referenceValue } = summary;

  return (
    <Panel title="Result" meta="run complete" variant="state" scrolls={false} className="grow">
      <div data-testid="completion-card" className="px-2.5 pb-1">
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
          {referenceValue === undefined ? null : (
            <p className="mt-1.5 text-micro text-accent-soft">
              Matches the value a real JVM computed for this example when the fixtures were built.
            </p>
          )}
        </div>

        {heap.length === 0 ? null : (
          <div className="mt-2.5 rounded-row bg-raised px-3 py-2.5">
            <p className="pb-2 text-meta text-fg-3">Heap as the run left it</p>
            <ol className="scroll-slim flex max-h-[150px] flex-col gap-3 overflow-y-auto">
              {heap.map((object, handle) =>
                object.kind === 'int-array' ? (
                  <HeapArrayRow key={handle} array={object} handle={handle} />
                ) : (
                  <HeapInstanceRow
                    key={handle}
                    instance={object}
                    handle={handle}
                    heap={heap}
                    externals={externals}
                  />
                ),
              )}
            </ol>
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
