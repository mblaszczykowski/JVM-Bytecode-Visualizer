import { useState } from 'react';

import {
  NO_EXTERNALS,
  type ExternalValue,
  type HeapObject,
  type StackFrame,
} from '../../core/interpreter';
import { cellValuesOf, heapFocusOf, type HeapFocus } from '../../services/views/heap-view';

import { HeapArrayRow, HeapInstanceRow } from './HeapRows';
import { Panel } from './Panel';
import { PANEL_INSET } from '../ui/rhythm';

interface HeapPanelProps {
  readonly heap: readonly HeapObject[];
  readonly frame?: StackFrame | undefined;
  readonly stepIndex?: number | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly mnemonic?: string | undefined;
}

type Pulses = readonly (readonly number[])[];

interface Tracked {
  readonly stepIndex: number | undefined;
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

function usePulses(stepIndex: number | undefined, heap: readonly HeapObject[]): Pulses {
  const [tracked, setTracked] = useState<Tracked>(() => ({
    stepIndex,
    heap,
    pulses: restingPulses(heap),
  }));

  if (tracked.heap !== heap) {
    const advanced =
      tracked.stepIndex === undefined || stepIndex === undefined || stepIndex > tracked.stepIndex;
    setTracked({
      stepIndex,
      heap,
      pulses: advanced ? nextPulses(tracked, heap) : restingPulses(heap),
    });
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
      <ol className={`flex flex-col gap-3 pb-0.5 ${PANEL_INSET}`}>
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
