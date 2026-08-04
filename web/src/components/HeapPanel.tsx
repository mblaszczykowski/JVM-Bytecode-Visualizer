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
  /** Objects by handle, straight off the snapshot; empty for a run that allocates nothing. */
  readonly heap: readonly HeapObject[];
  /** Top frame of the current snapshot — its operand stack names the element being touched. */
  readonly frame?: StackFrame | undefined;
  /** Mnemonic of the instruction the snapshot is about to run. */
  readonly mnemonic?: string | undefined;
}

/** A cell keeps the 26px rhythm and never falls below this, so long arrays scroll sideways. */
const CELL =
  'relative isolate flex h-[26px] items-center justify-center rounded-code font-mono text-code';

type Pulses = readonly (readonly number[])[];

interface Tracked {
  readonly heap: readonly HeapObject[];
  /** Per element, a counter bumped whenever the value changed — the key of one flash. */
  readonly pulses: Pulses;
}

/** Every element at rest: what a heap looks like the first time the panel sees it. */
function restingPulses(heap: readonly HeapObject[]): Pulses {
  return heap.map((object) => cellValuesOf(object).map(() => 0));
}

/**
 * Which elements changed since the last snapshot. `Heap.freeze()` hands back the very same
 * object for an array no step touched, so identity settles the question for a whole array
 * before a single element has to be compared.
 */
function nextPulses(previous: Tracked, heap: readonly HeapObject[]): Pulses {
  return heap.map((object, handle) => {
    const before = previous.heap[handle];
    const counters = previous.pulses[handle];
    const cells = cellValuesOf(object);
    // A freshly allocated object is not a change to show: every cell of it is new.
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

/**
 * Element-by-element history of the heap. Derived during render rather than in an effect, so
 * the flash and the new value are committed together — the same reasoning as the locals pulse.
 */
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
  /** Set when the current instruction is reading or writing an element of this array. */
  readonly focus?: HeapFocus | undefined;
  readonly pulses?: readonly number[] | undefined;
}

/**
 * One array: its name, and its elements as fixed cells with their indices underneath.
 *
 * Accent marks exactly one cell — the element the current instruction addresses — and the
 * pill spells out which one, so the highlight is not carried by colour alone.
 */
export function HeapArrayRow({ array, handle, focus, pulses }: HeapArrayRowProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <li data-testid="heap-array" data-handle={handle} className="px-[3px]">
      <div className="flex items-baseline gap-2 pb-[6px]">
        <span className="font-mono text-meta text-white/55">{objectLabel(array, handle)}</span>
        <span className="grow" />
        {focus === undefined ? (
          <span className="shrink-0 font-mono text-micro text-white/32">length {array.length}</span>
        ) : (
          <Pill tone="accent">
            {focus.mode === 'write' ? 'writes' : 'reads'} index {focus.index}
          </Pill>
        )}
      </div>

      <ol className="scroll-slim flex gap-[5px] overflow-x-auto pb-[2px]">
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
                  isFocused
                    ? 'bg-accent/[0.22] text-accent-text shadow-current'
                    : 'bg-white/5 text-white/75'
                }`}
              >
                {/*
                  A store rewrote this element: the accent fades off it rather than animating
                  the cell's own surface, so nothing about the row's geometry moves.
                */}
                {pulse === 0 ? null : (
                  <motion.span
                    key={pulse}
                    data-testid="heap-pulse"
                    aria-hidden="true"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-code bg-accent/[0.22]"
                  />
                )}
                {value}
              </span>
              <span
                className={`mt-[3px] text-center text-legend tracking-[0.1em] ${
                  isFocused ? 'text-accent-dim' : 'text-white/24'
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

/**
 * One instance: its class and handle, then a row per field.
 *
 * Fields are drawn as rows rather than as the cells an array gets, because they are named and
 * a name is what the reader needs to find one — an array is addressed by an index the
 * instruction supplies, an object by a name the source wrote.
 */
export function HeapInstanceRow({ instance, handle, pulses }: HeapInstanceRowProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <li data-testid="heap-instance" data-handle={handle} className="px-[3px]">
      <div className="flex items-baseline gap-2 pb-[6px]">
        <span className="font-mono text-meta text-white/55">{objectLabel(instance, handle)}</span>
        <span className="grow" />
        <span className="shrink-0 font-mono text-micro text-white/32">
          {instance.fields.length === 1 ? '1 field' : `${String(instance.fields.length)} fields`}
        </span>
      </div>

      <ol className="flex flex-col gap-[3px]">
        {instance.fields.map((field, index) => {
          const pulse = pulses?.[index] ?? 0;

          return (
            <li
              key={field.name}
              data-testid="heap-field"
              data-field={field.name}
              className={`${CELL} justify-between gap-3 bg-white/5 px-2 text-white/75`}
            >
              {pulse === 0 ? null : (
                <motion.span
                  key={pulse}
                  data-testid="heap-pulse"
                  aria-hidden="true"
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 -z-10 rounded-code bg-accent/[0.22]"
                />
              )}
              <span className="truncate text-white/55">{field.name}</span>
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

/** The one place that knows an object can be either kind; both rows below are total. */
function HeapObjectRow({ object, handle, focus, pulses }: HeapObjectRowProps) {
  return object.kind === 'int-array' ? (
    <HeapArrayRow array={object} handle={handle} focus={focus} pulses={pulses} />
  ) : (
    <HeapInstanceRow instance={object} handle={handle} pulses={pulses} />
  );
}

/**
 * Objects the run allocated, in handle order. The panel is not rendered at all for a program
 * that never touches the heap — most programs worth watching here never allocate, and an empty
 * section saying so would be noise on every one of their steps.
 */
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
      <ol className="flex flex-col gap-[12px] px-[10px] pb-[2px]">
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
