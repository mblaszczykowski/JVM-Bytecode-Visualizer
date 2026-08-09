import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handlesKeyItself, useTransportShortcuts } from './useTransportShortcuts';

function setup(enabled = true) {
  const handlers = {
    onTogglePlay: vi.fn(),
    onStepForward: vi.fn(),
    onStepBack: vi.fn(),
    onStepOver: vi.fn(),
    onStepOut: vi.fn(),
    onSeekToStart: vi.fn(),
    onSeekToEnd: vi.fn(),
  };
  renderHook(() => {
    useTransportShortcuts({ enabled, ...handlers });
  });
  return handlers;
}

function appendFocusable(tagName: string): HTMLElement {
  const element = document.createElement(tagName);
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('transport shortcuts', () => {
  it('maps space, the arrows and Home/End onto the transport', () => {
    const handlers = setup();

    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 'Home' });
    fireEvent.keyDown(document.body, { key: 'End' });

    expect(handlers.onTogglePlay).toHaveBeenCalledOnce();
    expect(handlers.onStepForward).toHaveBeenCalledOnce();
    expect(handlers.onStepBack).toHaveBeenCalledOnce();
    expect(handlers.onSeekToStart).toHaveBeenCalledOnce();
    expect(handlers.onSeekToEnd).toHaveBeenCalledOnce();
  });

  it('puts step over and step out on the vertical arrows', () => {
    const handlers = setup();

    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });

    expect(handlers.onStepOver).toHaveBeenCalledOnce();
    expect(handlers.onStepOut).toHaveBeenCalledOnce();
  });

  it('stops the page from scrolling on the vertical arrows', () => {
    setup();

    expect(fireEvent.keyDown(document.body, { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowUp' })).toBe(false);
  });

  it('leaves the arrows to a list that navigates with them itself', () => {
    const handlers = setup();
    const row = appendFocusable('button');

    row.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    fireEvent.keyDown(row, { key: 'ArrowDown' });

    expect(handlers.onStepOver).not.toHaveBeenCalled();
  });

  it('subscribes once and still calls the newest callbacks', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ onTogglePlay }: { onTogglePlay: () => void }) => {
        useTransportShortcuts({
          enabled: true,
          onTogglePlay,
          onStepForward: () => undefined,
          onStepBack: () => undefined,
          onStepOver: () => undefined,
          onStepOut: () => undefined,
          onSeekToStart: () => undefined,
          onSeekToEnd: () => undefined,
        });
      },
      { initialProps: { onTogglePlay: first } },
    );

    const subscriptions = () =>
      addListener.mock.calls.filter(([type]) => type === 'keydown').length;
    const afterMount = subscriptions();

    rerender({ onTogglePlay: second });
    fireEvent.keyDown(document.body, { key: ' ' });

    expect(subscriptions()).toBe(afterMount);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();

    addListener.mockRestore();
  });

  it('leaves other keys to the page', () => {
    const handlers = setup();

    const handled = fireEvent.keyDown(document.body, { key: 'k' });

    expect(handled).toBe(true);
    expect(handlers.onTogglePlay).not.toHaveBeenCalled();
  });

  it('stops the page from scrolling on a key it handled', () => {
    setup();

    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: 'PageDown' })).toBe(true);
  });

  it('does nothing while there is no history', () => {
    const handlers = setup(false);

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });

    expect(handlers.onStepForward).not.toHaveBeenCalled();
  });

  it('keeps out of the way of text entry', () => {
    const handlers = setup();
    const input = appendFocusable('input');
    const textarea = appendFocusable('textarea');

    fireEvent.keyDown(input, { key: ' ' });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(textarea, { key: ' ' });

    expect(handlers.onTogglePlay).not.toHaveBeenCalled();
    expect(handlers.onStepForward).not.toHaveBeenCalled();
  });

  it('lets a focused button keep its own space bar', () => {
    const handlers = setup();
    const button = appendFocusable('button');

    fireEvent.keyDown(button, { key: ' ' });
    fireEvent.keyDown(button, { key: 'ArrowRight' });

    expect(handlers.onTogglePlay).not.toHaveBeenCalled();
    expect(handlers.onStepForward).toHaveBeenCalledOnce();
  });

  it('ignores shortcuts combined with a modifier', () => {
    const handlers = setup();

    fireEvent.keyDown(document.body, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(document.body, { key: ' ', ctrlKey: true });

    expect(handlers.onStepForward).not.toHaveBeenCalled();
    expect(handlers.onTogglePlay).not.toHaveBeenCalled();
  });
});

describe('handlesKeyItself', () => {
  it('recognises editable content', () => {
    const editable = appendFocusable('div');
    editable.setAttribute('contenteditable', 'true');

    expect(handlesKeyItself(editable, 'ArrowRight')).toBe(true);
  });

  it('says nothing about a plain element', () => {
    expect(handlesKeyItself(appendFocusable('div'), ' ')).toBe(false);
    expect(handlesKeyItself(null, ' ')).toBe(false);
  });
});
