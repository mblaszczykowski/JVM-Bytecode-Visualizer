import { type KeyboardEvent, useState } from 'react';

export type NavigableRows = number | readonly number[];

export interface RowNavigation {
  readonly anchorIndex: number;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void;
}

export function useRowNavigation(
  rows: NavigableRows,
  currentIndex: number | undefined,
  rowAttribute = 'data-row-index',
): RowNavigation {
  const [roving, setRoving] = useState<number | undefined>(undefined);
  const [trackedCount, setTrackedCount] = useState(() => countOf(rows));
  const count = countOf(rows);

  if (count !== trackedCount) {
    setTrackedCount(count);
    setRoving(undefined);
  }

  const preferred = roving ?? currentIndex;
  const anchorIndex =
    preferred !== undefined && positionOf(rows, preferred) >= 0 ? preferred : (rowAt(rows, 0) ?? 0);

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number): void {
    const position = nextPosition(event.key, positionOf(rows, index), count - 1);
    if (position === undefined) {
      return;
    }
    const target = rowAt(rows, position);
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

function countOf(rows: NavigableRows): number {
  return typeof rows === 'number' ? rows : rows.length;
}

function rowAt(rows: NavigableRows, position: number): number | undefined {
  if (position < 0 || position >= countOf(rows)) {
    return undefined;
  }
  return typeof rows === 'number' ? position : rows[position];
}

function positionOf(rows: NavigableRows, index: number): number {
  if (typeof rows === 'number') {
    return index >= 0 && index < rows ? index : -1;
  }
  return rows.indexOf(index);
}

function nextPosition(key: string, position: number, lastPosition: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return Math.min(position + 1, lastPosition);
    case 'ArrowUp':
      return Math.max(position - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return lastPosition;
    default:
      return undefined;
  }
}
