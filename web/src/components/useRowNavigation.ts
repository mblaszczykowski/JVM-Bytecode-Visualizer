import { type KeyboardEvent, useState } from 'react';

export interface RowNavigation {
  /** The one row in the list that takes a tab stop. */
  readonly anchorIndex: number;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void;
}

/**
 * Roving tabindex over a list of code rows.
 *
 * Every row being a tab stop would bury the transport behind four hundred presses, so the
 * list takes exactly one: the current step, or wherever the arrow keys last left the reader.
 * Inside the list Up/Down/Home/End move the focus and Enter activates the row.
 *
 * The moved-to row is focused directly rather than through a ref array — a list this long
 * would otherwise carry one ref per instruction for the sake of four key presses.
 *
 * @param rowAttribute attribute the group's focusable elements carry. One list can hold two
 *   independent groups — the seek target of each instruction row and the constant pool link
 *   inside it — and each needs its own way of finding the element it is moving to.
 */
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

    // Also stops the global Home/End shortcuts from jumping the run to one of its ends.
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
