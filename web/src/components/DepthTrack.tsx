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
  readonly depths: readonly number[];
  readonly events?: readonly TimelineEvent[];
  readonly stepIndex: number;
  readonly onSeek: (index: number) => void;
  readonly label: string;
}

const MAX_BARS = 220;

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

const MARK_STYLES: Readonly<Record<TimelineEventKind, string>> = {
  print: 'h-[5px] bg-fg-2',
  'heap-write': 'h-[5px] bg-fg-3',
  call: 'h-[3px] bg-fg-dim',
  return: 'h-[3px] bg-fg-dim',
  branch: 'h-[3px] bg-line-strong',
};

interface FrameSpans {
  readonly from: readonly number[];
  readonly to: readonly number[];
}

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

export function DepthTrack({
  depths,
  events = NO_EVENTS,
  stepIndex,
  onSeek,
  label,
}: DepthTrackProps) {
  const buckets = useMemo(() => stepBucketsOf(depths.length, MAX_BARS), [depths.length]);
  const bars = useMemo(() => bucketDepths(depths, buckets), [depths, buckets]);
  const marks = useMemo(() => bucketEvents(events, buckets), [events, buckets]);
  const maxDepth = useMemo(
    () => depths.reduce((high, value) => Math.max(high, value), 1),
    [depths],
  );
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
    <div className="focus-ring-within relative h-11 grow rounded-row md:h-[34px]">
      {hasMarks ? (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 flex h-[5px] items-start gap-px"
        >
          {marks.map((mark, bucket) => (
            <span
              key={bars[bucket]?.firstStep ?? bucket}
              {...(mark === undefined ? {} : { 'data-testid': 'timeline-mark', 'data-kind': mark })}
              className={`flex-1 ${mark === undefined ? '' : MARK_STYLES[mark]}`}
            />
          ))}
        </div>
      ) : null}

      <div
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-px flex items-end gap-px ${
          hasMarks ? 'top-[7px]' : 'top-0'
        }`}
      >
        {bars.map((bar) => {
          const inCurrentFrame =
            span !== undefined && bar.lastStep >= span.from && bar.firstStep <= span.to;
          const played = bar.firstStep <= stepIndex;

          return (
            <span
              key={bar.firstStep}
              data-testid="depth-bar"
              data-frame={inCurrentFrame ? 'true' : undefined}
              className={`min-h-px flex-1 ${
                played
                  ? inCurrentFrame
                    ? 'bg-fg-2'
                    : 'bg-fg-3'
                  : inCurrentFrame
                    ? 'bg-fg-dim'
                    : 'bg-line-strong'
              }`}
              style={{ height: `${String((bar.depth / maxDepth) * 100)}%` }}
            />
          );
        })}
      </div>

      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-line" />

      <span
        aria-hidden="true"
        data-testid="scrubber-playhead"
        className="absolute inset-y-0 w-px bg-accent"
        style={{ left: `calc(${String(progress)}% - ${String(progress / 100)}px)` }}
      />

      <input
        type="range"
        min={0}
        max={lastIndex}
        step={1}
        value={stepIndex}
        onChange={handleChange}
        aria-label={label}
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
