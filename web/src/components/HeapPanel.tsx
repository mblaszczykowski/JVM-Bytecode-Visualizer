import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import type {
  ArrayObject,
  HeapObject,
  InstanceObject,
  StackFrame,
} from '../core/interpreter/types';

import { cellValuesOf, heapFocusOf, objectLabel, type HeapFocus } from './heap-view';
import { Panel } from './Panel';
import { Pill } from './ui/Pill';

interface HeapPanelProps {
  readonly heap: readonly HeapObject[];
  readonly frame?: StackFrame | undefined;
  readonly mnemonic?: string | undefined;
}

const CELL =
  'relative isolate flex h-[26px] items-center justify-center rounded-code font-mono text-code';

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

interface HeapArrayRowProps {
  readonly array: ArrayObject;
  readonly handle: number;
  readonly focus?: HeapFocus | undefined;
  readonly pulses?: readonly number[] | undefined;
}

export function HeapArrayRow({ array, handle, focus, pulses }: HeapArrayRowProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <li data-testid="heap-array" data-handle={handle} className="px-0.5">
      <div className="flex items-baseline gap-2 pb-1.5">
        <span className="font-mono text-meta text-fg-3">{objectLabel(array, handle)}</span>
        <span className="grow" />
        {focus === undefined ? (
          <span className="shrink-0 font-mono text-micro text-fg-3">length {array.length}</span>
        ) : (
          <Pill tone="accent">
            {focus.mode === 'write' ? 'writes' : 'reads'} index {focus.index}
          </Pill>
        )}
      </div>

      <ol className="scroll-slim flex gap-1 overflow-x-auto pb-0.5">
        {array.elements.map((value, index) => {
          const isFocused = focus?.index === index;
          const pulse = pulses?.[index] ?? 0;

          return (
            <li key={index} className="flex min-w-[34px] flex-1 flex-col">
              <span
                data-testid="heap-cell"
                data-index={index}
                data-current={isFocused ? 'true' : undefined}
                aria-current={isFocused ? 'true' : undefined}
                className={`${CELL} ${
                  isFocused ? 'now-row text-accent-text' : 'bg-raised text-fg-2'
                }`}
              >
                {pulse === 0 ? null : (
                  <motion.span
                    key={pulse}
                    data-testid="heap-pulse"
                    aria-hidden="true"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-code bg-accent/25"
                  />
                )}
                {value}
              </span>
              <span
                className={`mt-0.5 text-center text-legend tracking-[0.1em] ${
                  isFocused ? 'text-accent-dim' : 'text-fg-3'
                }`}
              >
                {index}
              </span>
            </li>
          );
        })}
      </ol>
    </li>
  );
}

interface HeapInstanceRowProps {
  readonly instance: InstanceObject;
  readonly handle: number;
  readonly pulses?: readonly number[] | undefined;
}

export function HeapInstanceRow({ instance, handle, pulses }: HeapInstanceRowProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <li data-testid="heap-instance" data-handle={handle} className="px-0.5">
      <div className="flex items-baseline gap-2 pb-1.5">
        <span className="font-mono text-meta text-fg-3">{objectLabel(instance, handle)}</span>
        <span className="grow" />
        <span className="shrink-0 font-mono text-micro text-fg-3">
          {instance.fields.length === 1 ? '1 field' : `${String(instance.fields.length)} fields`}
        </span>
      </div>

      <ol className="flex flex-col gap-0.5">
        {instance.fields.map((field, index) => {
          const pulse = pulses?.[index] ?? 0;

          return (
            <li
              key={field.name}
              data-testid="heap-field"
              data-field={field.name}
              className={`${CELL} justify-between gap-3 bg-raised px-2 text-fg-2`}
            >
              {pulse === 0 ? null : (
                <motion.span
                  key={pulse}
                  data-testid="heap-pulse"
                  aria-hidden="true"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 -z-10 rounded-code bg-accent/25"
                />
              )}
              <span className="truncate text-fg-3">{field.name}</span>
              <span>{field.kind === 'ref' && field.value < 0 ? 'null' : field.value}</span>
            </li>
          );
        })}
      </ol>
    </li>
  );
}

interface HeapObjectRowProps {
  readonly object: HeapObject;
  readonly handle: number;
  readonly focus?: HeapFocus | undefined;
  readonly pulses?: readonly number[] | undefined;
}

function HeapObjectRow({ object, handle, focus, pulses }: HeapObjectRowProps) {
  return object.kind === 'int-array' ? (
    <HeapArrayRow array={object} handle={handle} focus={focus} pulses={pulses} />
  ) : (
    <HeapInstanceRow instance={object} handle={handle} pulses={pulses} />
  );
}

export function HeapPanel({ heap, frame, mnemonic }: HeapPanelProps) {
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
            focus={focus?.handle === handle ? focus : undefined}
            pulses={pulses[handle]}
          />
        ))}
      </ol>
    </Panel>
  );
}
