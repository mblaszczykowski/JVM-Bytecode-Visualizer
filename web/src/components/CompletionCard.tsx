import type { HeapObject } from '../core/interpreter/types';
import type { RunSummary } from '../services/program';

import { HeapArrayRow, HeapInstanceRow } from './HeapPanel';
import { Panel } from './Panel';

interface CompletionCardProps {
  readonly summary: RunSummary;
  /** The heap as the run left it; empty for a program that never allocated anything. */
  readonly heap?: readonly HeapObject[] | undefined;
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

const NO_HEAP: readonly HeapObject[] = [];

/**
 * What the last snapshot is actually about. The call stack is empty there, so the three state
 * panels have nothing to say — but the run does: it produced a number, and it took a
 * measurable amount of machine to get there.
 *
 * A single returned int is not the whole answer for a program that sorts: what the run left on
 * the heap is, so the arrays come along and `int[5]@0` finishes as `1 2 3 4 5`.
 *
 * The reference value only appears when it agrees with the run. It is the result a real JVM
 * printed while the fixtures were built, so a match is the interpreter passing a differential
 * check in front of the reader rather than in CI.
 */
export function CompletionCard({ summary, heap = NO_HEAP }: CompletionCardProps) {
  const { resultName, resultValue, totalSteps, maxDepth, referenceValue } = summary;

  return (
    <Panel title="Result" meta="run complete" variant="state" scrolls={false} className="grow">
      <div data-testid="completion-card" className="px-[10px] pb-[4px]">
        <div className="rounded-row bg-accent/12 px-[12px] py-[10px] shadow-current">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-code text-accent-soft">{resultName}</span>
            <span className="font-mono text-code text-accent-soft/70">=</span>
            <span
              data-testid="result-value"
              className="font-mono text-display leading-none font-medium text-accent-text tabular-nums"
            >
              {resultValue ?? '—'}
            </span>
          </div>
          {referenceValue === undefined ? null : (
            <p className="mt-[7px] text-micro text-accent-soft/85">
              Matches the value a real JVM computed for this example when the fixtures were built.
            </p>
          )}
        </div>

        {heap.length === 0 ? null : (
          <div className="mt-[10px] rounded-row bg-raised px-[13px] py-[10px]">
            <p className="pb-[8px] text-meta text-fg-3">Heap as the run left it</p>
            {/* The card itself does not scroll, so a heap with a lot on it scrolls here. */}
            <ol className="scroll-slim flex max-h-[150px] flex-col gap-[12px] overflow-y-auto">
              {heap.map((object, handle) =>
                object.kind === 'int-array' ? (
                  <HeapArrayRow key={handle} array={object} handle={handle} />
                ) : (
                  <HeapInstanceRow key={handle} instance={object} handle={handle} />
                ),
              )}
            </ol>
          </div>
        )}

        <div className="mt-[10px] flex flex-col gap-[7px] rounded-row bg-raised px-[13px] py-[10px]">
          <Figure label="Steps executed" value={totalSteps.toLocaleString('en-US')} />
          <Figure label="Deepest call stack" value={`${String(maxDepth)} frames`} />
        </div>
      </div>
    </Panel>
  );
}
