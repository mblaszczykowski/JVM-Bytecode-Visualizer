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

interface FrameSpans {
  /** First step of the frame on top at step i. */
  readonly from: readonly number[];
  /** Last step of that same frame. */
  readonly to: readonly number[];
}

/**
 * Lifetime of the frame on top at every step: the widest run around the step whose depth
 * never drops below it. The frame is pushed when the depth first reaches that value and
 * popped when it falls below, so the depth history alone pins it down.
 *
 * Both ends are the nearest strictly shallower step, which two monotonic-stack passes find
 * for the whole history at once. Walking outwards from the current step instead would scan
 * all twenty thousand entries twice per tick whenever the run is flat.
 */
function frameSpansOf(depths: readonly number[]): FrameSpans {
  const count = depths.length;
  const from = new Array<number>(count).fill(0);
  const to = new Array<number>(count).fill(count - 1);
  const shallower: number[] = [];

  for (let step = 0; step < count; step++) {
    from[step] = popTo(shallower, depths, step) + 1;
    shallower.push(step);
  }

  shallower.length = 0;
  for (let step = count - 1; step >= 0; step--) {
    const next = popTo(shallower, depths, step);
    to[step] = next < 0 ? count - 1 : next - 1;
    shallower.push(step);
  }

  return { from, to };
}

/** Drops every stacked step at least as deep as `step`, and reports the one left below it. */
function popTo(stack: number[], depths: readonly number[], step: number): number {
  const depth = depths[step] ?? 0;
  for (;;) {
    const top = stack.at(-1);
    if (top === undefined) {
      return -1;
    }
    if ((depths[top] ?? 0) < depth) {
      return top;
    }
    stack.pop();
  }
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
  // Indexed once per history, so seeking is a pair of lookups rather than a scan.
  const spans = useMemo(() => frameSpansOf(depths), [depths]);
  const currentDepth = depths[stepIndex] ?? 0;
  const spanFrom = spans.from[stepIndex];
  const spanTo = spans.to[stepIndex];
  const span =
    currentDepth === 0 || spanFrom === undefined || spanTo === undefined
      ? undefined
      : { from: spanFrom, to: spanTo };

  const lastIndex = Math.max(depths.length - 1, 0);
  const progress = lastIndex === 0 ? 0 : (stepIndex / lastIndex) * 100;

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onSeek(Number(event.target.value));
  }

  return (
    // The input that carries the focus is transparent, so the ring has to sit on the chart.
    <div className={`focus-ring-within relative h-11 grow rounded-md md:h-[34px] ${className}`}>
      {/* Loud enough to read the shape of the recursion through the glass, still not chrome. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 bottom-[6px] flex items-end gap-px opacity-70"
      >
        {bars.map((bar) => {
          const inCurrentFrame =
            span !== undefined && bar.lastStep >= span.from && bar.firstStep <= span.to;

          return (
            <span
              key={bar.firstStep}
              data-testid="depth-bar"
              className={`min-h-[2px] flex-1 rounded-[1px] ${
                inCurrentFrame ? 'bg-[rgb(108_178_255/0.65)]' : 'bg-white/22'
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
        {/*
          The handle is 18px wide, so its centre has to travel between 9px and 9px-from-the-end
          rather than 0–100%; otherwise it hangs over both ends of the track.
        */}
        <span
          className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-handle"
          style={{ left: `calc(9px + (100% - 18px) * ${String(progress / 100)})` }}
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
