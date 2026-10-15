import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import {
  NO_EXTERNALS,
  NO_HEAP,
  type ExternalValue,
  type HeapObject,
  type StackFrame,
} from '../../core/interpreter';
import { describeValue } from '../../services/views/heap-view';

import { EmptyState, Panel } from './Panel';
import { Pill } from '../ui/Pill';
import { PANEL_INSET } from '../ui/rhythm';

interface CallStackPanelProps {
  readonly frames: readonly StackFrame[];
  readonly heap?: readonly HeapObject[] | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
}

const COLLAPSE_ABOVE = 8;
const OLDEST_KEPT = 2;
const NEWEST_KEPT = 5;

const RECEDED_BELOW = 3;

type Row =
  | { readonly kind: 'frame'; readonly frame: StackFrame; readonly index: number }
  | { readonly kind: 'collapsed'; readonly count: number };

function frameSurface(distanceFromTop: number): string {
  if (distanceFromTop === 0) {
    return 'now-row text-accent-text';
  }
  return distanceFromTop < RECEDED_BELOW
    ? 'bg-raised text-fg-2'
    : 'row-unreached bg-raised text-fg-3';
}

function firstArgument(
  frame: StackFrame,
  heap: readonly HeapObject[],
  externals: readonly ExternalValue[],
): string | undefined {
  const value = frame.locals[0];
  if (value === undefined) {
    return undefined;
  }
  const name = frame.localNames[0] ?? 'slot 0';
  const kind = frame.localKinds[0];
  return `${name}=${kind === undefined ? String(value) : describeValue(kind, value, heap, externals)}`;
}

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

export function CallStackPanel({
  frames,
  heap = NO_HEAP,
  externals = NO_EXTERNALS,
}: CallStackPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const duration = reduced ? 0 : 0.18;
  const topIndex = frames.length - 1;
  const rows = [...buildRows(frames, expanded)].reverse();

  return (
    <Panel
      title="Call stack"
      term="call-stack"
      meta={`depth ${String(frames.length)}`}
      variant="state"
      className="grow"
    >
      {frames.length === 0 ? (
        <EmptyState
          status="no active frame"
          detail="Execution finished: returning from the entry method popped the last frame."
        />
      ) : (
        <ol
          data-testid="call-frame-list"
          className={`flex flex-col-reverse gap-0.5 ${PANEL_INSET}`}
        >
          <AnimatePresence initial={false} mode="popLayout">
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
                      className="focus-ring w-full rounded-row px-2.5 py-1 text-left text-meta text-fg-3 transition-colors duration-150 hover:text-fg-2"
                    >
                      … {row.count} more frames
                    </button>
                  </li>
                );
              }

              const { frame, index } = row;
              const isTop = index === topIndex;
              const argument = firstArgument(frame, heap, externals);

              return (
                <motion.li
                  key={`${String(index)}:${frame.methodName}${frame.methodDescriptor}`}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration, ease: 'easeOut' }}
                  data-testid="call-frame"
                  data-frame-index={index}
                  aria-current={isTop ? 'true' : undefined}
                  title={`${frame.methodName}${frame.methodDescriptor}`}
                  className={`flex items-center gap-2 rounded-row px-2.5 py-1.5 text-label ${frameSurface(
                    topIndex - index,
                  )}`}
                >
                  <span className="w-3 shrink-0 font-mono text-micro text-fg-3">{index}</span>
                  <span className="truncate font-medium">{frame.methodName}</span>
                  <span className="grow" />
                  {argument === undefined ? null : (
                    <span className="shrink-0 font-mono text-meta text-fg-3">{argument}</span>
                  )}
                  {isTop ? <Pill tone="accent">pc {frame.pc}</Pill> : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </Panel>
  );
}
