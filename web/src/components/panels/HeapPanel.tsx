import { useState } from 'react';

import {
  NO_EXTERNALS,
  type ExternalValue,
  type HeapObject,
  type StackFrame,
} from '../../core/interpreter';
import { cellValuesOf, heapFocusOf } from '../../services/views/heap-view';

import { HeapObjectList, type HeapPulses } from './HeapObjectList';
import { Panel } from './Panel';
import { PANEL_INSET } from '../ui/rhythm';

interface HeapPanelProps {
  readonly heap: readonly HeapObject[];
  readonly frame?: StackFrame | undefined;
  readonly stepIndex?: number | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly mnemonic?: string | undefined;
}

interface Tracked {
  readonly stepIndex: number | undefined;
  readonly heap: readonly HeapObject[];
  readonly pulses: HeapPulses;
}

function nextPulses(previous: Tracked, heap: readonly HeapObject[]): HeapPulses {
  const next = new Map(previous.pulses);
  for (let handle = 0; handle < heap.length; handle++) {
    const object = heap[handle];
    if (object === undefined) {
      continue;
    }
    const before = previous.heap[handle];
    const counters = previous.pulses.get(handle);
    if (before === object) {
      continue;
    }
    if (before === undefined) {
      next.delete(handle);
      continue;
    }
    const cells = cellValuesOf(object);
    const past = cellValuesOf(before);
    if (past.length !== cells.length) {
      next.delete(handle);
      continue;
    }
    const updated = new Map(counters);
    for (let index = 0; index < cells.length; index++) {
      if (cells[index] !== past[index]) {
        updated.set(index, (counters?.get(index) ?? 0) + 1);
      }
    }
    if (updated.size > 0) {
      next.set(handle, updated);
    }
  }
  return next;
}

function usePulses(stepIndex: number | undefined, heap: readonly HeapObject[]): HeapPulses {
  const [tracked, setTracked] = useState<Tracked>(() => ({
    stepIndex,
    heap,
    pulses: new Map(),
  }));

  if (tracked.heap !== heap) {
    const advanced =
      tracked.stepIndex === undefined || stepIndex === undefined || stepIndex > tracked.stepIndex;
    setTracked({
      stepIndex,
      heap,
      pulses: advanced ? nextPulses(tracked, heap) : new Map(),
    });
  }

  return tracked.pulses;
}

export function HeapPanel({
  heap,
  frame,
  stepIndex,
  externals = NO_EXTERNALS,
  mnemonic,
}: HeapPanelProps) {
  const pulses = usePulses(stepIndex, heap);

  if (heap.length === 0) {
    return null;
  }

  const focus = heapFocusOf(mnemonic, frame, heap);

  return (
    <Panel
      title="Heap"
      meta={heap.length === 1 ? '1 object' : `${String(heap.length)} objects`}
      variant="state"
      className="grow"
    >
      <HeapObjectList
        heap={heap}
        externals={externals}
        focus={focus}
        pulses={pulses}
        className={`flex flex-col gap-3 pb-0.5 ${PANEL_INSET}`}
      />
    </Panel>
  );
}
