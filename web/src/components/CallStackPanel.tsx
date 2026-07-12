import { useState } from 'react';

import type { StackFrame } from '../core/interpreter/types';

import { Panel } from './Panel';
import { Pill } from './ui/Pill';

interface CallStackPanelProps {
  /** Frames in contract order: `[0]` is the oldest. */
  readonly frames: readonly StackFrame[];
}

/**
 * Depth is not part of the data model — it is the position in the array, and it is signalled
 * by opacity rather than indentation so every frame keeps the same left edge.
 */
const OPACITY_BY_DISTANCE = [1, 0.76, 0.58, 0.42] as const;
const DEEPEST_OPACITY = 0.42;

/** Deeper than this a recursive run stops fitting, so the middle collapses into one row. */
const COLLAPSE_ABOVE = 8;
const OLDEST_KEPT = 2;
const NEWEST_KEPT = 5;

type Row =
  | { readonly kind: 'frame'; readonly frame: StackFrame; readonly index: number }
  | { readonly kind: 'collapsed'; readonly count: number };

function frameOpacity(distanceFromTop: number): number {
  return OPACITY_BY_DISTANCE[distanceFromTop] ?? DEEPEST_OPACITY;
}

/** `n=2` — the first argument identifies a recursive frame far faster than the descriptor. */
function firstArgument(frame: StackFrame): string | undefined {
  const value = frame.locals[0];
  if (value === undefined) {
    return undefined;
  }
  const name = frame.localNames[0] ?? 'slot 0';
  return `${name}=${String(value)}`;
}

/** Rows in visual order, oldest first, with the middle folded away when the stack is deep. */
function buildRows(frames: readonly StackFrame[], expanded: boolean): readonly Row[] {
  const all: Row[] = frames.map((frame, index) => ({ kind: 'frame', frame, index }));
  if (expanded || frames.length <= COLLAPSE_ABOVE) {
    return all;
  }
  return [
    ...all.slice(0, OLDEST_KEPT),
    { kind: 'collapsed', count: frames.length - OLDEST_KEPT - NEWEST_KEPT },
    ...all.slice(frames.length - NEWEST_KEPT),
  ];
}

export function CallStackPanel({ frames }: CallStackPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const topIndex = frames.length - 1;
  // `flex-col-reverse` puts the first DOM child at the bottom, so the top frame ends up next
  // to the Locals panel that describes it — and a deep stack scrolls anchored to it.
  const rows = [...buildRows(frames, expanded)].reverse();

  return (
    <Panel
      title="Call stack"
      meta={`depth ${String(frames.length)}`}
      variant="state"
      className="min-h-[92px] flex-1"
    >
      {frames.length === 0 ? (
        <p className="px-[18px] py-3 text-[12px] text-white/30">
          No active frame — execution finished.
        </p>
      ) : (
        <ol data-testid="call-frame-list" className="flex flex-col-reverse gap-[5px] px-[10px]">
          {rows.map((row) => {
            if (row.kind === 'collapsed') {
              return (
                <li key="collapsed">
                  <button
                    type="button"
                    data-testid="collapsed-frames"
                    onClick={() => {
                      setExpanded(true);
                    }}
                    className="focus-ring w-full rounded-row px-[13px] py-[7px] text-left text-[11px] text-white/35 hover:text-white/60"
                  >
                    … {row.count} more frames
                  </button>
                </li>
              );
            }

            const { frame, index } = row;
            const isTop = index === topIndex;
            const argument = firstArgument(frame);

            return (
              <li
                key={`${String(index)}:${frame.methodName}${frame.methodDescriptor}`}
                data-testid="call-frame"
                data-frame-index={index}
                aria-current={isTop ? 'true' : undefined}
                title={`${frame.methodName}${frame.methodDescriptor}`}
                style={{ opacity: frameOpacity(topIndex - index) }}
                className={`flex items-center gap-2 rounded-row px-[13px] py-[9px] text-[12px] ${
                  isTop
                    ? 'bg-accent/[0.26] text-accent-text shadow-current-strong'
                    : 'bg-white/5 text-white/70'
                }`}
              >
                <span className="w-3 shrink-0 font-mono text-[10px] text-white/40">{index}</span>
                <span className="truncate font-medium">{frame.methodName}</span>
                <span className="grow" />
                {argument === undefined ? null : (
                  <span className="shrink-0 font-mono text-[11px] text-white/45">{argument}</span>
                )}
                {isTop ? <Pill tone="accent">pc {frame.pc}</Pill> : null}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
