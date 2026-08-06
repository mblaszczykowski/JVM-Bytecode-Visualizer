import type { HeapObject } from '../../core/interpreter/types';
import { referenceLabel } from '../heap-view';

interface ReferenceChipProps {
  readonly heap: readonly HeapObject[];
  /** The reference itself — a handle into the heap, or a value pointing at no object. */
  readonly handle: number;
  /** On an accent surface the chip has to sit on light; a second blue would disappear. */
  readonly onAccent?: boolean;
}

/**
 * A reference rendered as what it points at. The raw handle is an implementation detail of the
 * heap, and `0` in the operand stack means nothing to a reader — `int[5]@0` says both what the
 * value is and which object on screen it names.
 */
export function ReferenceChip({ heap, handle, onAccent = false }: ReferenceChipProps) {
  return (
    <span
      data-testid="ref-chip"
      className={`shrink-0 rounded-[4px] px-[6px] py-px font-mono text-label leading-[16px] ${
        onAccent ? 'bg-accent/25 text-accent-text' : 'bg-raised text-fg-2'
      }`}
    >
      {referenceLabel(heap, handle)}
    </span>
  );
}
