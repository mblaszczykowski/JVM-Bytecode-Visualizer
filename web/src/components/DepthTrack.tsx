import { type ChangeEvent, useMemo } from 'react';

import {
  bucketEvents,
  eventAt,
  stepBucketsOf,
  TIMELINE_EVENT_LABELS,
  type StepBucket,
  type TimelineEvent,
  type TimelineEventKind,
} from '../services/timeline';

interface DepthTrackProps {
  /** Call stack depth for every step of the run. */
  readonly depths: readonly number[];
  /** Ascending by step; empty leaves the marker lane out of the layout entirely. */
  readonly events?: readonly TimelineEvent[];
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

const NO_EVENTS: readonly TimelineEvent[] = [];

interface Bar extends StepBucket {
  readonly depth: number;
}

function bucketDepths(depths: readonly number[], buckets: readonly StepBucket[]): readonly Bar[] {
  return buckets.map((bucket) => {
    let depth = 0;
    for (let step = bucket.firstStep; step <= bucket.lastStep; step++) {
      depth = Math.max(depth, depths[step] ?? 0);
    }
    return { ...bucket, depth };
  });
}

/**
 * Neutral marks, never a second accent: the chart is read by shape and the accent is reserved
 * for "you are here". Weight is the only thing that separates the kinds — a write the program
 * can observe sits above the control flow the bars already draw.
 */
const MARK_STYLES: Readonly<Record<TimelineEventKind, string>> = {
  print: 'h-[5px] bg-white/55',
  'heap-write': 'h-[5px] bg-white/42',
  call: 'h-[3px] bg-white/30',
  return: 'h-[3px] bg-white/30',
  branch: 'h-[3px] bg-white/20',
};

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
 * Scrubber for the whole run: call stack depth as a bar chart, a lane of event marks above it
 * and the position track along its bottom edge. The chart itself is the control — a
 * transparent range input covers it, so clicking or dragging anywhere seeks, and keyboard and
 * screen readers get the native slider, which is also where the marks are put into words.
 */
export function DepthTrack({
  depths,
  events = NO_EVENTS,
  stepIndex,
  onSeek,
  label,
  className = '',
}: DepthTrackProps) {
  const buckets = useMemo(() => stepBucketsOf(depths.length, MAX_BARS), [depths.length]);
  const bars = useMemo(() => bucketDepths(depths, buckets), [depths, buckets]);
  const marks = useMemo(() => bucketEvents(events, buckets), [events, buckets]);
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
  const hasMarks = marks.some((mark) => mark !== undefined);
  const currentEvent = eventAt(events, stepIndex);
  const position = `step ${String(stepIndex + 1)} of ${String(depths.length)}`;

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onSeek(Number(event.target.value));
  }

  return (
    // The input that carries the focus is transparent, so the ring has to sit on the chart.
    <div className={`focus-ring-within relative h-11 grow rounded-md md:h-[34px] ${className}`}>
      {/*
        One cell per bar, cut on the same buckets, so a mark always sits over the steps it
        belongs to. Cells without an event stay in the row at zero height to hold the column.
      */}
      {hasMarks ? (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 flex h-[5px] items-start gap-px"
        >
          {marks.map((mark, bucket) => (
            <span
              key={bars[bucket]?.firstStep ?? bucket}
              {...(mark === undefined ? {} : { 'data-testid': 'timeline-mark', 'data-kind': mark })}
              className={`flex-1 rounded-[1px] ${mark === undefined ? '' : MARK_STYLES[mark]}`}
            />
          ))}
        </div>
      ) : null}

      {/* Loud enough to read the shape of the recursion through the glass, still not chrome. */}
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-[6px] flex items-end gap-px opacity-70 ${
          hasMarks ? 'top-[7px]' : 'top-0'
        }`}
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
        // The marks are decoration a screen reader never reaches; the slider is where the
        // event at the current step gets said out loud.
        aria-valuetext={
          currentEvent === undefined
            ? position
            : `${position}, ${TIMELINE_EVENT_LABELS[currentEvent]}`
        }
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
