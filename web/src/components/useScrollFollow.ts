import { type RefObject, useLayoutEffect, useRef } from 'react';

import { ROW_HEIGHT } from './rhythm';

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
