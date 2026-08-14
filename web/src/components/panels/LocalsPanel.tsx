import { useState } from 'react';

import {
  NO_EXTERNALS,
  NO_HEAP,
  type ExternalValue,
  type HeapObject,
  type StackFrame,
} from '../../core/interpreter';
import { useRowNavigation } from '../../hooks/useRowNavigation';
import { describeValue, objectTypeName } from '../../services/views/heap-view';

import { OriginButton } from '../ui/OriginButton';
import { EmptyState, Panel } from './Panel';
import { PulseOverlay } from '../ui/PulseOverlay';
import { ReferenceChip } from '../ui/ReferenceChip';
import { PANEL_INSET } from '../ui/rhythm';

interface LocalsPanelProps {
  readonly frame: StackFrame | undefined;
  readonly frameIndex?: number;
  readonly stepIndex?: number | undefined;
  readonly heap?: readonly HeapObject[] | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly caption?: string | undefined;
  readonly onSeekToStep?: ((step: number) => void) | undefined;
}

const UNINITIALISED = '·';

type Locals = readonly (number | undefined)[];

const NO_LOCALS: Locals = [];

interface Tracked {
  readonly stepIndex: number | undefined;
  readonly frameIndex: number;
  readonly locals: Locals;
  readonly pulses: readonly number[];
}

function stepAdvanced(previous: number | undefined, current: number | undefined): boolean {
  return previous === undefined || current === undefined || current > previous;
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

function usePulses(
  stepIndex: number | undefined,
  frameIndex: number,
  locals: Locals,
): readonly number[] {
  const [tracked, setTracked] = useState<Tracked>(() => ({
    stepIndex,
    frameIndex,
    locals,
    pulses: locals.map(() => 0),
  }));

  if (tracked.locals !== locals || tracked.frameIndex !== frameIndex) {
    setTracked({
      stepIndex,
      frameIndex,
      locals,
      pulses: stepAdvanced(tracked.stepIndex, stepIndex)
        ? nextPulses(tracked, frameIndex, locals)
        : locals.map(() => 0),
    });
  }

  return tracked.pulses;
}

export function LocalsPanel({
  frame,
  frameIndex = 0,
  stepIndex,
  caption,
  heap = NO_HEAP,
  externals = NO_EXTERNALS,
  onSeekToStep,
}: LocalsPanelProps) {
  const pulses = usePulses(stepIndex, frameIndex, frame?.locals ?? NO_LOCALS);

  const traceable = (frame?.locals ?? NO_LOCALS)
    .map((_, slot) => slot)
    .filter((slot) => frame?.localOrigins[slot] !== undefined);
  const origins = useRowNavigation(traceable.length, 0, 'data-origin-row');
  const originRow = new Map(traceable.map((slot, position) => [slot, position]));

  if (frame === undefined) {
    return (
      <Panel title="Locals" term="local-variable-slot" meta="–" variant="state" className="grow">
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
      term="local-variable-slot"
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
        <ol className={`flex flex-col gap-0.5 pb-0.5 ${PANEL_INSET}`}>
          {locals.map((value, slot) => {
            const name = localNames[slot] ?? `slot ${String(slot)}`;
            const isInitialised = value !== undefined;
            const pulse = pulses[slot] ?? 0;
            const kind = frame.localKinds[slot];
            const isReference = kind === 'ref' || kind === 'external';
            const origin = frame.localOrigins[slot];
            const originPosition = originRow.get(slot);
            const label =
              value === undefined || kind === undefined
                ? UNINITIALISED
                : describeValue(kind, value, heap, externals);
            const referent = kind === 'ref' && value !== undefined ? heap[value] : undefined;
            const slotType = kind === 'ref' ? referent && objectTypeName(referent) : 'I';

            return (
              <li
                key={slot}
                data-testid="local-slot"
                data-slot={slot}
                className={`relative isolate flex items-center gap-2 rounded-row px-2.5 py-1 text-label ${
                  isInitialised ? 'bg-raised' : 'shadow-row-outline'
                }`}
              >
                <PulseOverlay pulse={pulse} testId="local-pulse" className="rounded-row" />
                <span className="w-3 shrink-0 font-mono text-micro text-fg-3">{slot}</span>
                <span className={isInitialised ? 'text-fg-2' : 'text-fg-3'}>{name}</span>
                {isInitialised && kind !== 'external' && slotType !== undefined ? (
                  <span className="font-mono text-meta text-fg-3">{`: ${slotType}`}</span>
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
