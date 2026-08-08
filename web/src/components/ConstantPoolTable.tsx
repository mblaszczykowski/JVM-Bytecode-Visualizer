import { useLayoutEffect, useRef, type RefObject } from 'react';

import type { ConstantPoolRow } from '../services/class-view';

import { CODE_ROW, ROW_HEIGHT } from './rhythm';
import { useRowNavigation } from './useRowNavigation';

export interface ConstantPoolTableProps {
  readonly rows: readonly ConstantPoolRow[];
  /** Index the reader is following, from a `#7` in the listing or from a row of this table. */
  readonly selectedIndex?: number | undefined;
  /** Follow a pool index — both the listing and this table's own cross-references use it. */
  readonly onSelectIndex?: ((index: number) => void) | undefined;
}

/**
 * The constant pool as a table of links rather than a dump.
 *
 * Every entry that names other entries (JVMS §4.4: a `Methodref` names a `Class` and a
 * `NameAndType`) carries them as `#n` affordances, so the pool can be walked down to the Utf8
 * strings at the bottom. That is the half of the cross-link the Bytecode panel starts: a `#7`
 * operand selects a row here, and a row here selects itself.
 *
 * Rows echo the 26px code register, because a pool entry is read the same way a disassembled
 * instruction is — one line, never wrapped, the panel scrolling sideways instead.
 */
export function ConstantPoolTable({ rows, selectedIndex, onSelectIndex }: ConstantPoolTableProps) {
  const selectedRow = rows.findIndex((row) => row.index === selectedIndex);
  // A class file of any size has hundreds of pool entries. One tab stop for the whole table,
  // arrows inside it — the same bargain `BytecodePanel` makes with its listing.
  const nav = useRowNavigation(rows.length, selectedRow < 0 ? undefined : selectedRow);
  const listRef = useFollowSelected(selectedIndex);

  return (
    <ol ref={listRef} className="isolate px-2.5">
      {rows.map((row, position) => {
        const isSelected = row.index === selectedIndex;
        // The row and its references share the row's single tab stop, so reaching a reference
        // is one Tab from the row rather than one Tab per entry in the whole pool.
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
            // Selection is the reader's position in the pool, which is what the accent is for.
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
                // Spelled out rather than left to the three cells: read as one string they run
                // together, and "#7" alone says nothing about what is being selected.
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
                    // Without a handler the references are still worth showing: they are what
                    // the entry is made of, and the reader can find them by index.
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

/** The chip a constant pool reference is drawn as, matching the resolution chain in `Next`. */
const REFERENCE =
  'shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-micro leading-none text-accent-soft';

/**
 * Keeps the selected row inside the middle third of whichever ancestor scrolls.
 *
 * The table sits in a panel body it does not own, so the container is found rather than held
 * as a ref — but the technique is the one `useScrollFollow` uses, and for its reason:
 * `scrollIntoView` scrolls every scrollable ancestor and drags the whole shell with it, while
 * setting `scrollTop` by hand touches exactly one element.
 */
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

    // Measured rather than multiplied out of the row index: unlike the code panels, the rows
    // above this table are a header, a field table and a method list of unknown height.
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
