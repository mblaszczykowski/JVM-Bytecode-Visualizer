import type { HeapObject } from '../../core/interpreter/types';
import { referenceLabel } from '../heap-view';

interface ReferenceChipProps {
  readonly heap: readonly HeapObject[];
  readonly handle: number;
  readonly onAccent?: boolean;
}

export function ReferenceChip({ heap, handle, onAccent = false }: ReferenceChipProps) {
  return (
    <span
      data-testid="ref-chip"
      className={`shrink-0 rounded-[4px] px-1.5 py-px font-mono text-label ${
        onAccent ? 'bg-accent/25 text-accent-text' : 'bg-raised text-fg-2'
      }`}
    >
      {referenceLabel(heap, handle)}
    </span>
  );
}
