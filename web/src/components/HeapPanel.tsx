import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import type { ArrayObject, StackFrame } from '../core/interpreter/types';

import { arrayLabel, heapFocusOf, type HeapFocus } from './heap-view';
import { Panel } from './Panel';
import { Pill } from './ui/Pill';

interface HeapPanelProps {
  /** Objects by handle, straight off the snapshot; empty for a run that allocates nothing. */
  readonly heap: readonly ArrayObject[];
  /** Top frame of the current snapshot — its operand stack names the element being touched. */
  readonly frame?: StackFrame | undefined;
  /** Mnemonic of the instruction the snapshot is about to run. */
  readonly mnemonic?: string | undefined;
}

/** A cell keeps the 26px rhythm and never falls below this, so long arrays scroll sideways. */
const CELL =
  'relative isolate flex h-[26px] items-center justify-center rounded-code font-mono text-[12.5px]';

type Pulses = readonly (readonly number[])[];

interface Tracked {
  readonly heap: readonly ArrayObject[];
  /** Per element, a counter bumped whenever the value changed — the key of one flash. */
  readonly pulses: Pulses;
}

/** Every element at rest: what a heap looks like the first time the panel sees it. */
function restingPulses(heap: readonly ArrayObject[]): Pulses {
  return heap.map((array) => array.elements.map(() => 0));
}

/**
 * Which elements changed since the last snapshot. `Heap.freeze()` hands back the very same
 * object for an array no step touched, so identity settles the question for a whole array
 * before a single element has to be compared.
 */
function nextPulses(previous: Tracked, heap: readonly ArrayObject[]): Pulses {
  return heap.map((array, handle) => {
    const before = previous.heap[handle];
    const counters = previous.pulses[handle];
    // A freshly allocated array is not a change to show: every cell of it is new.
    if (before === undefined || counters === undefined || before.length !== array.length) {
      return array.elements.map(() => 0);
    }
    if (before === array) {
      return counters;
    }
    return array.elements.map((value, index) => {
      const counter = counters[index] ?? 0;
      return value === before.elements[index] ? counter : counter + 1;
    });
  });
}

/**
 * Element-by-element history of the heap. Derived during render rather than in an effect, so
 * the flash and the new value are committed together — the same reasoning as the locals pulse.
 */
function usePulses(heap: readonly ArrayObject[]): Pulses {
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
        <span className="font-mono text-[11.5px] text-white/55">{arrayLabel(array, handle)}</span>
        <span className="grow" />
        {focus === undefined ? (
          <span className="shrink-0 font-mono text-[10px] text-white/32">
            length {array.length}
          </span>
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
                className={`mt-[3px] text-center text-[9px] tracking-[0.1em] ${
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

/**
 * Objects the run allocated, in handle order. The panel is not rendered at all for a program
 * that never touches the heap — four of the five examples are pure int arithmetic, and an
 * empty section saying so would be noise on every one of their steps.
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
      meta={heap.length === 1 ? '1 array' : `${String(heap.length)} arrays`}
      variant="state"
      bodyFill="short"
    >
      <ol className="flex flex-col gap-[12px] px-[10px] pb-[2px]">
        {heap.map((array, handle) => (
          <HeapArrayRow
            key={handle}
            array={array}
            handle={handle}
            focus={focus?.handle === handle ? focus : undefined}
            pulses={pulses[handle]}
          />
        ))}
      </ol>
    </Panel>
  );
}
