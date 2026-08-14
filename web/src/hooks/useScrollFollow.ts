import { type RefObject, useLayoutEffect, useRef } from 'react';

import { ROW_HEIGHT } from '../components/ui/rhythm';

export type RowTop = number | ((container: HTMLElement) => number | undefined);

export function useScrollFollow(rowTop: RowTop | undefined): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || rowTop === undefined) {
      return;
    }

    const viewport = container.clientHeight;
    if (viewport === 0) {
      return;
    }

    const top = typeof rowTop === 'function' ? rowTop(container) : rowTop;
    if (top === undefined || top < 0) {
      return;
    }

    const third = viewport / 3;
    const isInsideMiddleThird =
      top >= container.scrollTop + third && top + ROW_HEIGHT <= container.scrollTop + 2 * third;

    if (isInsideMiddleThird) {
      return;
    }

    const centred = top - viewport / 2 + ROW_HEIGHT / 2;
    container.scrollTop = Math.max(0, Math.min(centred, container.scrollHeight - viewport));
  }, [rowTop]);

  return containerRef;
}

export function rowTopOf(index: number | undefined): number | undefined {
  return index === undefined || index < 0 ? undefined : index * ROW_HEIGHT;
}
