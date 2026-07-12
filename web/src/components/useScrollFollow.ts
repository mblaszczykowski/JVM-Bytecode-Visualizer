import { type RefObject, useLayoutEffect, useRef } from 'react';

import { ROW_HEIGHT } from './rhythm';

/**
 * Keeps the row at `index` inside the middle third of its scroll container.
 *
 * `scrollIntoView` is deliberately avoided: it scrolls every scrollable ancestor, which
 * drags the whole app shell around and breaks the layout of an embedding host page.
 * Setting `scrollTop` by hand touches exactly one element.
 */
export function useScrollFollow(index: number | undefined): RefObject<HTMLDivElement> {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null || index === undefined || index < 0) {
      return;
    }

    const viewport = container.clientHeight;
    if (viewport === 0) {
      return;
    }

    const rowTop = index * ROW_HEIGHT;
    const third = viewport / 3;
    const isInsideMiddleThird =
      rowTop >= container.scrollTop + third &&
      rowTop + ROW_HEIGHT <= container.scrollTop + 2 * third;

    if (isInsideMiddleThird) {
      return;
    }

    const centred = rowTop - viewport / 2 + ROW_HEIGHT / 2;
    container.scrollTop = Math.max(0, Math.min(centred, container.scrollHeight - viewport));
  }, [index]);

  return containerRef;
}
