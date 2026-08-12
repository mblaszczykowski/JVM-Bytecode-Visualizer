import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFileDropGuard } from './useFileDropGuard';

interface DragPayload {
  readonly types?: readonly string[];
  readonly files?: readonly File[];
}

function dispatchDrag(type: string, { types = ['Files'], files = [] }: DragPayload = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types, files, dropEffect: 'none' },
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function classFile(name = 'Factorial.class'): File {
  return new File([new Uint8Array([0xca, 0xfe, 0xba, 0xbe])], name);
}

describe('useFileDropGuard', () => {
  it('is not a drop target until a file is dragged over the page', () => {
    const onDropped = vi.fn();
    const { result } = renderHook(() => useFileDropGuard(onDropped));

    expect(result.current).toBe(false);
  });

  it('becomes a drop target while a file is over the page', () => {
    const onDropped = vi.fn();
    const { result } = renderHook(() => useFileDropGuard(onDropped));

    dispatchDrag('dragenter');
    expect(result.current).toBe(true);

    dispatchDrag('dragleave');
    expect(result.current).toBe(false);
  });

  it('counts nested enters, so crossing a child does not clear the target', () => {
    const onDropped = vi.fn();
    const { result } = renderHook(() => useFileDropGuard(onDropped));

    dispatchDrag('dragenter');
    dispatchDrag('dragenter');
    dispatchDrag('dragleave');

    expect(result.current).toBe(true);

    dispatchDrag('dragleave');
    expect(result.current).toBe(false);
  });

  it('ignores a drag that carries no files, such as selected text', () => {
    const onDropped = vi.fn();
    const { result } = renderHook(() => useFileDropGuard(onDropped));

    dispatchDrag('dragenter', { types: ['text/plain'] });
    expect(result.current).toBe(false);

    const over = dispatchDrag('dragover', { types: ['text/plain'] });
    expect(over.defaultPrevented).toBe(false);

    dispatchDrag('drop', { types: ['text/plain'], files: [classFile()] });
    expect(onDropped).not.toHaveBeenCalled();
  });

  it('claims the drag, so the browser does not navigate to the file', () => {
    const onDropped = vi.fn();
    renderHook(() => useFileDropGuard(onDropped));

    const over = dispatchDrag('dragover');

    expect(over.defaultPrevented).toBe(true);
    expect((over as DragEvent).dataTransfer?.dropEffect).toBe('copy');
  });

  it('reports the first dropped file and stops being a drop target', () => {
    const onDropped = vi.fn();
    const file = classFile();
    const { result } = renderHook(() => useFileDropGuard(onDropped));

    dispatchDrag('dragenter');
    const drop = dispatchDrag('drop', { files: [file, classFile('Other.class')] });

    expect(onDropped).toHaveBeenCalledExactlyOnceWith(file);
    expect(drop.defaultPrevented).toBe(true);
    expect(result.current).toBe(false);
  });

  it('lets go of the window when it unmounts', () => {
    const onDropped = vi.fn();
    const { unmount } = renderHook(() => useFileDropGuard(onDropped));

    unmount();
    dispatchDrag('drop', { files: [classFile()] });

    expect(onDropped).not.toHaveBeenCalled();
  });
});
