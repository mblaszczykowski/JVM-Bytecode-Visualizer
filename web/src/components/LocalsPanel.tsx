import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import type { StackFrame } from '../core/interpreter/types';

import { Panel } from './Panel';

interface LocalsPanelProps {
  /** Top frame of the current snapshot; `undefined` when the call stack is empty. */
  readonly frame: StackFrame | undefined;
  /** Depth of that frame — a different depth is a different set of variables. */
  readonly frameIndex?: number;
}

/** `undefined` in the contract means "not initialised yet", not zero. */
const UNINITIALISED = '·';

type Locals = readonly (number | undefined)[];

/** Stable identity: a fresh `[]` per render would restart the change tracking every frame. */
const NO_LOCALS: Locals = [];

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

export function LocalsPanel({ frame, frameIndex = 0 }: LocalsPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const pulses = usePulses(frameIndex, frame?.locals ?? NO_LOCALS);

  if (frame === undefined) {
    return (
      <Panel title="Locals" meta="—" variant="state" scrolls={false}>
        <p className="px-[18px] py-3 text-[12px] text-white/55">No active frame.</p>
      </Panel>
    );
  }

  const { locals, localNames } = frame;

  return (
    <Panel title="Locals" meta={`${String(locals.length)} slots`} variant="state" scrolls={false}>
      {locals.length === 0 ? (
        <p className="px-[23px] py-2 text-[12px] text-white/55">no local slots</p>
      ) : (
        <ul className="flex flex-col gap-[5px] px-[10px] pb-[2px]">
          {locals.map((value, slot) => {
            // Names come from the LocalVariableTable (javac -g); without it only the slot is left.
            const name = localNames[slot] ?? `slot ${String(slot)}`;
            const isInitialised = value !== undefined;
            const pulse = pulses[slot] ?? 0;

            return (
              <li
                key={slot}
                data-testid="local-slot"
                data-slot={slot}
                className={`relative isolate flex items-center gap-2 rounded-row px-[13px] py-[8px] text-[12px] ${
                  isInitialised ? 'bg-white/5' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]'
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
                <span className="w-3 shrink-0 font-mono text-[10px] text-white/32">{slot}</span>
                <span className={isInitialised ? 'text-white/75' : 'text-white/30'}>{name}</span>
                {/* The supported instruction subset only models int locals. */}
                {isInitialised ? (
                  <span className="font-mono text-[11px] text-white/55">: I</span>
                ) : null}
                <span className="grow" />
                <span
                  className={`font-mono text-[14px] ${
                    isInitialised ? 'text-white/90' : 'text-white/30'
                  }`}
                >
                  {isInitialised ? value : UNINITIALISED}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
