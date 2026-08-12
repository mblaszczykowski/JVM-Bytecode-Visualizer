import { useState } from 'react';

import type { ExternalValue, HeapObject, StackFrame } from '../core/interpreter';
import { cellValuesOf, heapFocusOf, type HeapFocus } from '../services/heap-view';

import { HeapArrayRow, HeapInstanceRow } from './HeapRows';
import { Panel } from './Panel';

interface HeapPanelProps {
  readonly heap: readonly HeapObject[];
  readonly frame?: StackFrame | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly mnemonic?: string | undefined;
}

type Pulses = readonly (readonly number[])[];

interface Tracked {
  readonly heap: readonly HeapObject[];
  readonly pulses: Pulses;
}

function restingPulses(heap: readonly HeapObject[]): Pulses {
  return heap.map((object) => cellValuesOf(object).map(() => 0));
}

function nextPulses(previous: Tracked, heap: readonly HeapObject[]): Pulses {
  return heap.map((object, handle) => {
    const before = previous.heap[handle];
    const counters = previous.pulses[handle];
    const cells = cellValuesOf(object);
    if (
      before === undefined ||
      counters === undefined ||
      cellValuesOf(before).length !== cells.length
    ) {
      return cells.map(() => 0);
    }
    if (before === object) {
      return counters;
    }
    const past = cellValuesOf(before);
    return cells.map((value, index) => {
      const counter = counters[index] ?? 0;
      return value === past[index] ? counter : counter + 1;
    });
  });
}

function usePulses(heap: readonly HeapObject[]): Pulses {
  const [tracked, setTracked] = useState<Tracked>(() => ({ heap, pulses: restingPulses(heap) }));

  if (tracked.heap !== heap) {
    setTracked({ heap, pulses: nextPulses(tracked, heap) });
  }

  return tracked.pulses;
}

interface HeapObjectRowProps {
  readonly object: HeapObject;
  readonly handle: number;
  readonly heap: readonly HeapObject[];
  readonly externals: readonly ExternalValue[];
  readonly focus?: HeapFocus | undefined;
  readonly pulses?: readonly number[] | undefined;
}

function HeapObjectRow({ object, handle, heap, externals, focus, pulses }: HeapObjectRowProps) {
  return object.kind === 'int-array' ? (
    <HeapArrayRow array={object} handle={handle} focus={focus} pulses={pulses} />
  ) : (
    <HeapInstanceRow
      instance={object}
      handle={handle}
      heap={heap}
      externals={externals}
      pulses={pulses}
    />
  );
}

const NO_EXTERNALS: readonly ExternalValue[] = [];

export function HeapPanel({ heap, frame, externals = NO_EXTERNALS, mnemonic }: HeapPanelProps) {
  const pulses = usePulses(heap);

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
      <ol className="flex flex-col gap-3 px-2.5 pb-0.5">
        {heap.map((object, handle) => (
          <HeapObjectRow
            key={handle}
            object={object}
            handle={handle}
            heap={heap}
            externals={externals}
            focus={focus?.handle === handle ? focus : undefined}
            pulses={pulses[handle]}
          />
        ))}
      </ol>
    </Panel>
  );
}
