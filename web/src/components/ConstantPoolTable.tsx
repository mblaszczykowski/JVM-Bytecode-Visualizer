import { useLayoutEffect, useRef, type RefObject } from 'react';

import type { ConstantPoolRow } from '../services/class-view';

import { CODE_ROW, ROW_HEIGHT } from './rhythm';
import { useRowNavigation } from './useRowNavigation';

export interface ConstantPoolTableProps {
  readonly rows: readonly ConstantPoolRow[];
  readonly selectedIndex?: number | undefined;
  readonly onSelectIndex?: ((index: number) => void) | undefined;
}

export function ConstantPoolTable({ rows, selectedIndex, onSelectIndex }: ConstantPoolTableProps) {
  const selectedRow = rows.findIndex((row) => row.index === selectedIndex);
  const nav = useRowNavigation(rows.length, selectedRow < 0 ? undefined : selectedRow);
  const listRef = useFollowSelected(selectedIndex);

  return (
    <ol ref={listRef} className="isolate px-2.5">
      {rows.map((row, position) => {
        const isSelected = row.index === selectedIndex;
        const tabIndex = position === nav.anchorIndex ? 0 : -1;

        const cells = (
          <>
            <span
              className={`w-9 shrink-0 text-right select-none ${
                isSelected ? 'text-accent-dim' : 'text-fg-3'
              }`}
            >
              #{row.index}
            </span>
            <span className={`w-[104px] shrink-0 ${isSelected ? '' : 'text-fg-3'}`}>
              {row.tagName}
            </span>
            <span className={isSelected ? '' : 'text-fg-2'}>{row.text}</span>
          </>
        );

        return (
          <li
            key={row.index}
            data-testid="constant-row"
            data-index={row.index}
            aria-current={isSelected ? 'true' : undefined}
            className={`${CODE_ROW} ${isSelected ? 'bg-accent/[0.22] text-accent-text shadow-current' : ''}`}
          >
            {onSelectIndex === undefined ? (
              <span className="flex grow items-center gap-3">{cells}</span>
            ) : (
              <button
                type="button"
                data-row-index={position}
                tabIndex={tabIndex}
                aria-label={`Constant pool entry #${String(row.index)}, ${row.tagName}, ${row.text}`}
                onClick={() => {
                  onSelectIndex(row.index);
                }}
                onKeyDown={(event) => {
                  nav.onKeyDown(event, position);
                }}
                className="focus-ring flex grow items-center gap-3 self-stretch rounded-code text-left"
              >
                {cells}
              </button>
            )}

            {row.references.length === 0 ? null : (
              <span className="flex shrink-0 items-center gap-1 pl-3">
                {row.references.map((reference, order) =>
                  onSelectIndex === undefined ? (
                    <span key={`${String(order)}:${String(reference)}`} className={REFERENCE}>
                      #{reference}
                    </span>
                  ) : (
                    <button
                      key={`${String(order)}:${String(reference)}`}
                      type="button"
                      tabIndex={tabIndex}
                      aria-label={`Follow constant pool entry #${String(reference)}`}
                      onClick={() => {
                        onSelectIndex(reference);
                      }}
                      className={`focus-ring ${REFERENCE} hover:bg-raised-active`}
                    >
                      #{reference}
                    </button>
                  ),
                )}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const REFERENCE =
  'shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-micro leading-none text-accent-soft';

function useFollowSelected(selectedIndex: number | undefined): RefObject<HTMLOListElement> {
  const listRef = useRef<HTMLOListElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null || selectedIndex === undefined) {
      return;
    }
    const row = list.querySelector<HTMLElement>(`[data-index="${String(selectedIndex)}"]`);
    const container = scrollingAncestorOf(list);
    if (row === null || container === undefined) {
      return;
    }

    const viewport = container.clientHeight;
    if (viewport === 0) {
      return;
    }

    const rowTop =
      container.scrollTop + row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const third = viewport / 3;
    const isInsideMiddleThird =
      rowTop >= container.scrollTop + third &&
      rowTop + ROW_HEIGHT <= container.scrollTop + 2 * third;

    if (isInsideMiddleThird) {
      return;
    }

    const centred = rowTop - viewport / 2 + ROW_HEIGHT / 2;
    container.scrollTop = Math.max(0, Math.min(centred, container.scrollHeight - viewport));
  }, [selectedIndex]);

  return listRef;
}

function scrollingAncestorOf(node: HTMLElement): HTMLElement | undefined {
  for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return parent;
    }
  }
  return undefined;
}
