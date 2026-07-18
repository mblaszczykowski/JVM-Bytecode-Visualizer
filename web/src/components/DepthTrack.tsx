import { type ChangeEvent, useMemo } from 'react';

interface DepthTrackProps {
  /** Call stack depth for every step of the run. */
  readonly depths: readonly number[];
  readonly stepIndex: number;
  readonly onSeek: (index: number) => void;
  readonly label: string;
  readonly className?: string;
}

/**
 * A run can reach twenty thousand steps, so bars are bucketed down to something a track can
 * actually show — one bar per step would be both invisible and slow.
 */
const MAX_BARS = 120;

interface Bar {
  readonly depth: number;
  readonly firstStep: number;
  readonly lastStep: number;
}

function bucketDepths(depths: readonly number[]): readonly Bar[] {
  const count = Math.min(MAX_BARS, Math.max(depths.length, 1));
  const bars: Bar[] = [];

  for (let bar = 0; bar < count; bar++) {
    const firstStep = Math.floor((bar * depths.length) / count);
    const lastStep = Math.max(firstStep, Math.floor(((bar + 1) * depths.length) / count) - 1);
    let depth = 0;
    for (let step = firstStep; step <= lastStep; step++) {
      depth = Math.max(depth, depths[step] ?? 0);
    }
    bars.push({ depth, firstStep, lastStep });
  }

  return bars;
}

/**
 * Lifetime of the frame currently on top: the widest run of steps around `stepIndex` whose
 * depth never drops below the current one. The frame is pushed when the depth first reaches
 * that value and popped when it falls below, so the depth history alone pins it down.
 */
function currentFrameSpan(
  depths: readonly number[],
  stepIndex: number,
): { readonly from: number; readonly to: number } | undefined {
  const depth = depths[stepIndex];
  if (depth === undefined || depth === 0) {
    return undefined;
  }

  let from = stepIndex;
  while (from > 0 && (depths[from - 1] ?? 0) >= depth) {
    from--;
  }
  let to = stepIndex;
  while (to < depths.length - 1 && (depths[to + 1] ?? 0) >= depth) {
    to++;
  }
  return { from, to };
}

/**
 * Scrubber for the whole run: call stack depth as a bar chart with the position track along
 * its bottom edge. The chart itself is the control — a transparent range input covers it, so
 * clicking or dragging anywhere seeks, and keyboard and screen readers get the native slider.
 */
export function DepthTrack({ depths, stepIndex, onSeek, label, className = '' }: DepthTrackProps) {
  const bars = useMemo(() => bucketDepths(depths), [depths]);
  const maxDepth = useMemo(
    () => depths.reduce((high, value) => Math.max(high, value), 1),
    [depths],
  );
  const span = currentFrameSpan(depths, stepIndex);

  const lastIndex = Math.max(depths.length - 1, 0);
  const progress = lastIndex === 0 ? 0 : (stepIndex / lastIndex) * 100;

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onSeek(Number(event.target.value));
  }

  return (
    // The input that carries the focus is transparent, so the ring has to sit on the chart.
    <div className={`focus-ring-within relative h-11 grow rounded-md md:h-[34px] ${className}`}>
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 bottom-[6px] flex items-end gap-px opacity-50"
      >
        {bars.map((bar) => {
          const inCurrentFrame =
            span !== undefined && bar.lastStep >= span.from && bar.firstStep <= span.to;

          return (
            <span
              key={bar.firstStep}
              data-testid="depth-bar"
              className={`min-h-[2px] flex-1 rounded-[1px] ${
                inCurrentFrame ? 'bg-[rgb(108_178_255/0.65)]' : 'bg-white/16'
              }`}
              style={{ height: `${String((bar.depth / maxDepth) * 100)}%` }}
            />
          );
        })}
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[6px] rounded-full bg-white/12"
      >
        <div
          className="h-full rounded-full bg-accent shadow-scrubber"
          style={{ width: `${String(progress)}%` }}
        />
        <span
          className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-handle"
          style={{ left: `${String(progress)}%` }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={lastIndex}
        step={1}
        value={stepIndex}
        onChange={handleChange}
        aria-label={label}
        aria-valuetext={`step ${String(stepIndex + 1)} of ${String(depths.length)}`}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
