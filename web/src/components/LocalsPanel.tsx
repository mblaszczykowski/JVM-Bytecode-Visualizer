import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

import type { ExternalValue, HeapObject, StackFrame } from '../core/interpreter';
import { useRowNavigation } from '../hooks/useRowNavigation';
import { describeValue } from '../services/derivations';

import { OriginButton } from './OriginButton';
import { EmptyState, Panel } from './Panel';
import { ReferenceChip } from './ui/ReferenceChip';

interface LocalsPanelProps {
  readonly frame: StackFrame | undefined;
  readonly frameIndex?: number;
  readonly heap?: readonly HeapObject[] | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly caption?: string | undefined;
  readonly onSeekToStep?: ((step: number) => void) | undefined;
}

const UNINITIALISED = '·';

type Locals = readonly (number | undefined)[];

const NO_LOCALS: Locals = [];

const NO_HEAP: readonly HeapObject[] = [];

const NO_EXTERNALS: readonly ExternalValue[] = [];

interface Tracked {
  readonly frameIndex: number;
  readonly locals: Locals;
  readonly pulses: readonly number[];
}

function nextPulses(previous: Tracked, frameIndex: number, locals: Locals): readonly number[] {
  if (previous.frameIndex !== frameIndex) {
    return locals.map(() => 0);
  }
  return locals.map((value, slot) => {
    const pulse = previous.pulses[slot] ?? 0;
    return value === previous.locals[slot] ? pulse : pulse + 1;
  });
}

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
  externals = NO_EXTERNALS,
  onSeekToStep,
}: LocalsPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const pulses = usePulses(frameIndex, frame?.locals ?? NO_LOCALS);

  const traceable = (frame?.locals ?? NO_LOCALS)
    .map((_, slot) => slot)
    .filter((slot) => frame?.localOrigins?.[slot] !== undefined);
  const origins = useRowNavigation(traceable.length, 0, 'data-origin-row');
  const originRow = new Map(traceable.map((slot, position) => [slot, position]));

  if (frame === undefined) {
    return (
      <Panel title="Locals" meta="–" variant="state" className="grow">
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
          detail="This method declares no variables; it works entirely on the operand stack."
        />
      ) : (
        <ol className="flex flex-col gap-0.5 px-2 pb-0.5">
          {locals.map((value, slot) => {
            const name = localNames[slot] ?? `slot ${String(slot)}`;
            const isInitialised = value !== undefined;
            const pulse = pulses[slot] ?? 0;
            const kind = frame.localKinds?.[slot];
            const isReference = kind === 'ref' || kind === 'external';
            const origin = frame.localOrigins?.[slot];
            const originPosition = originRow.get(slot);
            const label =
              value === undefined ? UNINITIALISED : describeValue(kind, value, heap, externals);

            return (
              <li
                key={slot}
                data-testid="local-slot"
                data-slot={slot}
                className={`relative isolate flex items-center gap-2 rounded-row px-2.5 py-1 text-label ${
                  isInitialised ? 'bg-raised' : 'shadow-row-outline'
                }`}
              >
                {pulse === 0 ? null : (
                  <motion.span
                    key={pulse}
                    aria-hidden="true"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-row bg-accent-fill"
                  />
                )}
                <span className="w-3 shrink-0 font-mono text-micro text-fg-3">{slot}</span>
                <span className={isInitialised ? 'text-fg-2' : 'text-fg-3'}>{name}</span>
                {isInitialised && kind !== 'external' ? (
                  <span className="font-mono text-meta text-fg-3">
                    {kind === 'ref' ? ': int[]' : ': I'}
                  </span>
                ) : null}
                <span className="grow" />
                {origin === undefined ||
                originPosition === undefined ||
                onSeekToStep === undefined ? null : (
                  <OriginButton
                    step={origin}
                    sentence={`${name} was set to ${label}`}
                    testId="local-origin"
                    row={originPosition}
                    anchorRow={origins.anchorIndex}
                    onSeekToStep={onSeekToStep}
                    onKeyDown={origins.onKeyDown}
                  />
                )}
                {isInitialised && isReference ? (
                  <ReferenceChip label={label} />
                ) : (
                  <span
                    className={`font-mono text-body ${isInitialised ? 'text-fg' : 'text-fg-3'}`}
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
