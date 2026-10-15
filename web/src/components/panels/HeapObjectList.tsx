import { useState } from 'react';

import type { ExternalValue, HeapObject } from '../../core/interpreter';
import type { HeapFocus } from '../../services/views/heap-view';

import { HeapArrayRow, HeapInstanceRow } from './HeapRows';
import { Button } from '../ui/Button';

export const HEAP_OBJECTS_PER_PAGE = 32;

export type HeapPulses = ReadonlyMap<number, ReadonlyMap<number, number>>;

interface HeapObjectListProps {
  readonly heap: readonly HeapObject[];
  readonly externals: readonly ExternalValue[];
  readonly focus?: HeapFocus | undefined;
  readonly pulses?: HeapPulses | undefined;
  readonly className?: string;
}

export function HeapObjectList({
  heap,
  externals,
  focus,
  pulses,
  className = '',
}: HeapObjectListProps) {
  const [tracked, setTracked] = useState({
    page: Math.floor((focus?.handle ?? 0) / HEAP_OBJECTS_PER_PAGE),
    focusHandle: focus?.handle,
  });
  if (tracked.focusHandle !== focus?.handle) {
    setTracked({
      page: focus === undefined ? tracked.page : Math.floor(focus.handle / HEAP_OBJECTS_PER_PAGE),
      focusHandle: focus?.handle,
    });
  }
  const lastPage = Math.max(0, Math.ceil(heap.length / HEAP_OBJECTS_PER_PAGE) - 1);
  const page = Math.min(tracked.page, lastPage);
  const from = page * HEAP_OBJECTS_PER_PAGE;
  const shown = heap.slice(from, from + HEAP_OBJECTS_PER_PAGE);

  return (
    <>
      <ol className={className}>
        {shown.map((object, position) => {
          const handle = from + position;
          return object.kind === 'int-array' ? (
            <HeapArrayRow
              key={handle}
              array={object}
              handle={handle}
              focus={focus?.handle === handle ? focus : undefined}
              pulses={pulses?.get(handle)}
            />
          ) : (
            <HeapInstanceRow
              key={handle}
              instance={object}
              handle={handle}
              heap={heap}
              externals={externals}
              pulses={pulses?.get(handle)}
            />
          );
        })}
      </ol>
      {lastPage === 0 ? null : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 px-3 text-meta text-fg-3">
          <span>
            objects {from + 1}–{from + shown.length} of {heap.length}
          </span>
          <span className="grow" />
          <Button
            size="sm"
            disabled={page === 0}
            aria-label="Previous heap objects"
            onClick={() => {
              setTracked({ ...tracked, page: page - 1 });
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            disabled={page === lastPage}
            aria-label="Next heap objects"
            onClick={() => {
              setTracked({ ...tracked, page: page + 1 });
            }}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}
