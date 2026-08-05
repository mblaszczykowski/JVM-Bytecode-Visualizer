import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import type { HeapObject, StackFrame } from '../core/interpreter/types';

import { referenceLabel } from './heap-view';
import { EmptyState, Panel } from './Panel';
import { ReferenceChip } from './ui/ReferenceChip';
import { useRowNavigation } from './useRowNavigation';

interface LocalsPanelProps {
  /** Top frame of the current snapshot; `undefined` when the call stack is empty. */
  readonly frame: StackFrame | undefined;
  /** Depth of that frame — a different depth is a different set of variables. */
  readonly frameIndex?: number;
  /** Objects of the current snapshot, so a `ref` slot can name what it points at. */
  readonly heap?: readonly HeapObject[] | undefined;
  /** Replaces the slot count in the header when the panel is showing a frame that is gone. */
  readonly caption?: string | undefined;
  /**
   * Follow a slot back to the step that last wrote it. Omitted, the origins stay data the
   * panel does not offer to act on and no row grows a control.
   */
  readonly onSeekToStep?: ((step: number) => void) | undefined;
}

/** `undefined` in the contract means "not initialised yet", not zero. */
const UNINITIALISED = '·';

type Locals = readonly (number | undefined)[];

/** Stable identity: a fresh `[]` per render would restart the change tracking every frame. */
const NO_LOCALS: Locals = [];

/** Stable identity for the int-only runs, which never hand the panel a heap of their own. */
const NO_HEAP: readonly HeapObject[] = [];

/**
 * Where a value came from is not what the machine is doing now, so it is deliberately the
 * quietest thing in the row: no fill until it is pointed at, and one notch under the value it
 * belongs to. Blue is spoken for — it means "current state", and the row already uses it for
 * the change pulse (design §12).
 */
const ORIGIN_BUTTON =
  'focus-ring shrink-0 rounded-[4px] px-[4px] text-micro text-white/45 transition-colors hover:bg-white/12 hover:text-white/85';

interface Tracked {
  readonly frameIndex: number;
  readonly locals: Locals;
  /** Bumped for a slot whose value changed; the value itself keys nothing, the counter does. */
  readonly pulses: readonly number[];
}

function nextPulses(previous: Tracked, frameIndex: number, locals: Locals): readonly number[] {
  // A call or a return swaps the whole set of variables; only assignments inside one frame
  // are a "change" worth showing.
  if (previous.frameIndex !== frameIndex) {
    return locals.map(() => 0);
  }
  return locals.map((value, slot) => {
    const pulse = previous.pulses[slot] ?? 0;
    return value === previous.locals[slot] ? pulse : pulse + 1;
  });
}

/**
 * Slot-by-slot history of the locals. Derived during render rather than in an effect, so the
 * pulse and the new value are committed together and no frame shows one without the other.
 */
function usePulses(frameIndex: number, locals: Locals): readonly number[] {
  const [tracked, setTracked] = useState<Tracked>(() => ({
    frameIndex,
    locals,
    pulses: locals.map(() => 0),
  }));

  if (tracked.locals !== locals || tracked.frameIndex !== frameIndex) {
    setTracked({ frameIndex, locals, pulses: nextPulses(tracked, frameIndex, locals) });
  }

  return tracked.pulses;
}

export function LocalsPanel({
  frame,
  frameIndex = 0,
  caption,
  heap = NO_HEAP,
  onSeekToStep,
}: LocalsPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const pulses = usePulses(frameIndex, frame?.locals ?? NO_LOCALS);

  /**
   * Slots that know where they came from — an uninitialised one has no origin and is offered
   * nothing. Built before the empty branch below because the roving tabindex over them is a
   * hook.
   *
   * A snapshot is the state *before* its instruction runs, so an origin is always a step
   * strictly earlier than the one on screen: following one can never be a jump to where the
   * reader already is, and there is no no-op case to suppress.
   */
  const traceable = (frame?.locals ?? NO_LOCALS)
    .map((_, slot) => slot)
    .filter((slot) => frame?.localOrigins?.[slot] !== undefined);
  const origins = useRowNavigation(traceable.length, 0, 'data-origin-row');
  const originRow = new Map(traceable.map((slot, position) => [slot, position]));

  if (frame === undefined) {
    return (
      <Panel title="Locals" meta="—" variant="state" className="grow">
        <EmptyState
          status="no active frame"
          detail="Local variables belong to a frame, and the run has none left."
        />
      </Panel>
    );
  }

  const { locals, localNames } = frame;

  return (
    <Panel
      title="Locals"
      meta={caption ?? `${String(locals.length)} slots`}
      variant="state"
      className="grow"
    >
      {locals.length === 0 ? (
        <EmptyState
          status="no local slots"
          detail="This method declares no variables — it works entirely on the operand stack."
        />
      ) : (
        // Ordered: a slot is a numbered position, and the roving tabindex finds its siblings
        // by looking for the `ol` they share.
        <ol className="flex flex-col gap-[5px] px-[10px] pb-[2px]">
          {locals.map((value, slot) => {
            // Names come from the LocalVariableTable (javac -g); without it only the slot is left.
            const name = localNames[slot] ?? `slot ${String(slot)}`;
            const isInitialised = value !== undefined;
            const pulse = pulses[slot] ?? 0;
            // A reference slot holds a heap handle, which on its own says nothing.
            const isReference = frame.localKinds?.[slot] === 'ref';
            const origin = frame.localOrigins?.[slot];
            const originPosition = originRow.get(slot);

            return (
              <li
                key={slot}
                data-testid="local-slot"
                data-slot={slot}
                className={`relative isolate flex items-center gap-2 rounded-row px-[13px] py-[8px] text-label ${
                  isInitialised ? 'bg-white/5' : 'shadow-row-outline'
                }`}
              >
                {/*
                  The one place accent appears outside "this is the current state": an overlay
                  that fades out, so the row's own surface never has to be animated. The row
                  isolates, so the negative z-index lands above its fill and under its text.
                */}
                {pulse === 0 ? null : (
                  <motion.span
                    key={pulse}
                    aria-hidden="true"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-row bg-accent/[0.22]"
                  />
                )}
                <span className="w-3 shrink-0 font-mono text-micro text-white/32">{slot}</span>
                <span className={isInitialised ? 'text-white/75' : 'text-white/30'}>{name}</span>
                {/* The subset models two kinds of slot: an int, and a reference to an int array. */}
                {isInitialised ? (
                  <span className="font-mono text-meta text-white/55">
                    {isReference ? ': int[]' : ': I'}
                  </span>
                ) : null}
                <span className="grow" />
                {/* Left of the value, so the values keep their column at the edge of the row
                    rather than jittering with the width of a step number. */}
                {origin === undefined ||
                originPosition === undefined ||
                onSeekToStep === undefined ? null : (
                  <button
                    type="button"
                    data-testid="local-origin"
                    data-origin-row={originPosition}
                    tabIndex={originPosition === origins.anchorIndex ? 0 : -1}
                    aria-label={`Go to step ${String(origin + 1)}, where ${name} was set to ${
                      isReference ? referenceLabel(heap, value) : String(value)
                    }`}
                    onClick={() => {
                      onSeekToStep(origin);
                    }}
                    onKeyDown={(event) => {
                      origins.onKeyDown(event, originPosition);
                    }}
                    className={ORIGIN_BUTTON}
                  >
                    {/* 1-based, like the step counter and the shareable link. */}
                    {`from ${String(origin + 1)}`}
                  </button>
                )}
                {isInitialised && isReference ? (
                  <ReferenceChip heap={heap} handle={value} />
                ) : (
                  <span
                    className={`font-mono text-body ${
                      isInitialised ? 'text-white/90' : 'text-white/30'
                    }`}
                  >
                    {isInitialised ? value : UNINITIALISED}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
