import { type KeyboardEvent, useState } from 'react';

export interface RowNavigation {
  readonly anchorIndex: number;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void;
}

export function useRowNavigation(
  rowCount: number,
  currentIndex: number | undefined,
  rowAttribute = 'data-row-index',
): RowNavigation {
  const [roving, setRoving] = useState<number | undefined>(undefined);
  const lastIndex = Math.max(rowCount - 1, 0);
  const anchorIndex = Math.min(Math.max(roving ?? currentIndex ?? 0, 0), lastIndex);

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number): void {
    const target = nextIndex(event.key, index, lastIndex);
    if (target === undefined) {
      return;
    }

    event.preventDefault();
    setRoving(target);
    event.currentTarget
      .closest('ol')
      ?.querySelector<HTMLElement>(`[${rowAttribute}="${String(target)}"]`)
      ?.focus();
  }

  return { anchorIndex, onKeyDown };
}

function nextIndex(key: string, index: number, lastIndex: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return Math.min(index + 1, lastIndex);
    case 'ArrowUp':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return lastIndex;
    default:
      return undefined;
  }
}
