import {
  NO_EXTERNALS,
  NO_HEAP,
  type ArrayObject,
  type ExternalValue,
  type HeapObject,
  type InstanceObject,
} from '../../core/interpreter';
import { describeValue } from '../../services/views/derivations';
import { objectLabel, type HeapFocus } from '../../services/views/heap-view';

import { Pill } from '../ui/Pill';
import { PulseOverlay } from '../ui/PulseOverlay';

const CELL =
  'relative isolate flex h-[26px] items-center justify-center rounded-code font-mono text-code';

interface HeapArrayRowProps {
  readonly array: ArrayObject;
  readonly handle: number;
  readonly focus?: HeapFocus | undefined;
  readonly pulses?: readonly number[] | undefined;
}

export function HeapArrayRow({ array, handle, focus, pulses }: HeapArrayRowProps) {
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
                <PulseOverlay pulse={pulse} testId="heap-pulse" className="rounded-code" />
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
  readonly heap?: readonly HeapObject[] | undefined;
  readonly externals?: readonly ExternalValue[] | undefined;
  readonly pulses?: readonly number[] | undefined;
}

export function HeapInstanceRow({
  instance,
  handle,
  heap = NO_HEAP,
  externals = NO_EXTERNALS,
  pulses,
}: HeapInstanceRowProps) {
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
              <PulseOverlay pulse={pulse} testId="heap-pulse" className="rounded-code" />
              <span className="truncate text-fg-3">{field.name}</span>
              <span>{describeValue(field.kind, field.value, heap, externals)}</span>
            </li>
          );
        })}
      </ol>
    </li>
  );
}
