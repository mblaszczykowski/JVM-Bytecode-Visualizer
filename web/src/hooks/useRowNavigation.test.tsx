import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useRowNavigation, type NavigableRows } from './useRowNavigation';

interface ListProps {
  readonly rows: NavigableRows;
  readonly currentIndex?: number | undefined;
}

function indicesOf(rows: NavigableRows): readonly number[] {
  return typeof rows === 'number' ? Array.from({ length: rows }, (_, index) => index) : rows;
}

function RowList({ rows, currentIndex }: ListProps) {
  const nav = useRowNavigation(rows, currentIndex);

  return (
    <ol>
      {indicesOf(rows).map((index) => (
        <li key={index}>
          <button
            type="button"
            data-row-index={index}
            tabIndex={index === nav.anchorIndex ? 0 : -1}
            onKeyDown={(event) => {
              nav.onKeyDown(event, index);
            }}
          >
            row {index}
          </button>
        </li>
      ))}
    </ol>
  );
}

function renderList(props: ListProps) {
  const view = render(<RowList {...props} />);
  return {
    rerender: (next: ListProps) => {
      view.rerender(<RowList {...next} />);
    },
  };
}

function rowAt(index: number): HTMLElement {
  return screen.getByRole('button', { name: `row ${String(index)}` });
}

function anchor(): number {
  const tabbable = screen.getAllByRole('button').filter((row) => row.tabIndex === 0);
  expect(tabbable).toHaveLength(1);
  return Number(tabbable[0]?.dataset.rowIndex);
}

describe('useRowNavigation', () => {
  it('puts the tab stop on the current row and moves it with the arrow keys', () => {
    renderList({ rows: 4, currentIndex: 1 });

    expect(anchor()).toBe(1);

    fireEvent.keyDown(rowAt(1), { key: 'ArrowDown' });

    expect(anchor()).toBe(2);
    expect(rowAt(2)).toHaveFocus();

    fireEvent.keyDown(rowAt(2), { key: 'End' });
    expect(anchor()).toBe(3);

    fireEvent.keyDown(rowAt(3), { key: 'ArrowDown' });
    expect(anchor()).toBe(3);

    fireEvent.keyDown(rowAt(3), { key: 'Home' });
    expect(anchor()).toBe(0);

    fireEvent.keyDown(rowAt(0), { key: 'ArrowUp' });
    expect(anchor()).toBe(0);
  });

  it('leaves a key it does not navigate with to the row', () => {
    renderList({ rows: 4, currentIndex: 0 });

    expect(fireEvent.keyDown(rowAt(0), { key: 'Enter' })).toBe(true);
    expect(anchor()).toBe(0);
  });

  it('goes back to the current row when the list underneath it changes', () => {
    const { rerender } = renderList({ rows: 40, currentIndex: 0 });

    fireEvent.keyDown(rowAt(0), { key: 'ArrowDown' });
    fireEvent.keyDown(rowAt(1), { key: 'ArrowDown' });
    fireEvent.keyDown(rowAt(2), { key: 'ArrowDown' });
    expect(anchor()).toBe(3);

    rerender({ rows: 3, currentIndex: 0 });

    expect(anchor()).toBe(0);
  });

  describe('a list where only some rows can be reached', () => {
    const MAPPED = [2, 5, 7];

    it('anchors on the first reachable row when the current one is not reachable', () => {
      renderList({ rows: MAPPED, currentIndex: 0 });

      expect(anchor()).toBe(2);
    });

    it('anchors on the first reachable row when there is no current row at all', () => {
      renderList({ rows: MAPPED, currentIndex: undefined });

      expect(anchor()).toBe(2);
    });

    it('keeps the tab stop on the current row when that row can be reached', () => {
      renderList({ rows: MAPPED, currentIndex: 5 });

      expect(anchor()).toBe(5);
    });

    it('steps between the reachable rows rather than through the gaps', () => {
      renderList({ rows: MAPPED, currentIndex: 2 });

      fireEvent.keyDown(rowAt(2), { key: 'ArrowDown' });

      expect(anchor()).toBe(5);
      expect(rowAt(5)).toHaveFocus();

      fireEvent.keyDown(rowAt(5), { key: 'End' });
      expect(anchor()).toBe(7);

      fireEvent.keyDown(rowAt(7), { key: 'ArrowUp' });
      expect(anchor()).toBe(5);
    });
  });
});
