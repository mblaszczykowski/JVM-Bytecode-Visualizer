import { useRowNavigation } from '../../hooks/useRowNavigation';
import type { ConstantPoolRow } from '../../services/class-view';

import { CODE_ROW, NAME_COLUMN, POOL_INDEX_COLUMN } from '../rhythm';

export interface ConstantPoolListProps {
  readonly rows: readonly ConstantPoolRow[];
  readonly selectedIndex?: number | undefined;
  readonly onSelectIndex?: ((index: number) => void) | undefined;
}

const REFERENCE =
  'shrink-0 rounded-row bg-raised px-1.5 py-0.5 text-micro leading-none text-accent-soft';

export function ConstantPoolList({ rows, selectedIndex, onSelectIndex }: ConstantPoolListProps) {
  const selectedRow = rows.findIndex((row) => row.index === selectedIndex);
  const nav = useRowNavigation(rows.length, selectedRow < 0 ? undefined : selectedRow);

  return (
    <ol className="isolate px-2.5">
      {rows.map((row, position) => {
        const isSelected = row.index === selectedIndex;
        const tabIndex = position === nav.anchorIndex ? 0 : -1;

        const cells = (
          <>
            <span className={`${POOL_INDEX_COLUMN} ${isSelected ? 'text-fg-2' : 'text-fg-3'}`}>
              #{row.index}
            </span>
            <span className={`${NAME_COLUMN} ${isSelected ? '' : 'text-fg-3'}`}>{row.tagName}</span>
            <span className={isSelected ? '' : 'text-fg-2'}>{row.text}</span>
          </>
        );

        return (
          <li
            key={row.index}
            data-testid="constant-row"
            data-index={row.index}
            aria-current={isSelected ? 'true' : undefined}
            className={`${CODE_ROW} ${
              isSelected ? 'bg-raised-active text-fg shadow-control-raised' : ''
            }`}
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
