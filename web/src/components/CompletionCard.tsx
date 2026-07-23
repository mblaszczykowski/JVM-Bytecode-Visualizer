import type { RunSummary } from '../services/program';

import { Panel } from './Panel';

interface CompletionCardProps {
  readonly summary: RunSummary;
}

interface FigureProps {
  readonly label: string;
  readonly value: string;
}

function Figure({ label, value }: FigureProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11.5px] text-white/55">{label}</span>
      <span className="font-mono text-[13px] text-white/90 tabular-nums">{value}</span>
    </div>
  );
}

/**
 * What the last snapshot is actually about. The call stack is empty there, so the three state
 * panels have nothing to say — but the run does: it produced a number, and it took a
 * measurable amount of machine to get there.
 *
 * The reference value only appears when it agrees with the run. It is the result a real JVM
 * printed while the fixtures were built, so a match is the interpreter passing a differential
 * check in front of the reader rather than in CI.
 */
export function CompletionCard({ summary }: CompletionCardProps) {
  const { resultName, resultValue, totalSteps, maxDepth, referenceValue } = summary;

  return (
    <Panel title="Result" meta="run complete" variant="state" scrolls={false}>
      <div data-testid="completion-card" className="px-[10px] pb-[4px]">
        <div className="rounded-row bg-accent/[0.22] px-[13px] py-[11px] shadow-current">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[12.5px] text-accent-soft">{resultName}</span>
            <span className="font-mono text-[12.5px] text-accent-soft/70">=</span>
            <span className="font-mono text-[26px] leading-none font-medium text-accent-text tabular-nums">
              {resultValue ?? '—'}
            </span>
          </div>
          {referenceValue === undefined ? null : (
            <p className="mt-[7px] text-[10.5px] leading-[14px] text-accent-soft/85">
              Matches the value a real JVM computed for this example when the fixtures were built.
            </p>
          )}
        </div>

        <div className="mt-[10px] flex flex-col gap-[7px] rounded-row bg-white/5 px-[13px] py-[10px]">
          <Figure label="Steps executed" value={totalSteps.toLocaleString('en-US')} />
          <Figure label="Deepest call stack" value={`${String(maxDepth)} frames`} />
        </div>
      </div>
    </Panel>
  );
}
