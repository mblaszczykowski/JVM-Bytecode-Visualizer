import { useEffect, useRef } from 'react';

export interface TransportShortcuts {
  readonly enabled: boolean;
  readonly onTogglePlay: () => void;
  readonly onStepForward: () => void;
  readonly onStepBack: () => void;
  readonly onStepOver: () => void;
  readonly onStepOut: () => void;
  readonly onSeekToStart: () => void;
  readonly onSeekToEnd: () => void;
}

const SCROLL_KEYS: ReadonlySet<string> = new Set([
  ' ',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function handlesKeyItself(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('[contenteditable]:not([contenteditable="false"])') !== null) {
    return true;
  }
  switch (target.tagName) {
    case 'INPUT':
    case 'TEXTAREA':
    case 'SELECT':
      return true;
    case 'BUTTON':
    case 'A':
      return key === ' ';
    default:
      return SCROLL_KEYS.has(key) && target.closest('[data-scroll-region]') !== null;
  }
}

export function useTransportShortcuts(shortcuts: TransportShortcuts): void {
  const { enabled } = shortcuts;
  const latest = useRef(shortcuts);

  useEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (handlesKeyItself(event.target, event.key)) {
        return;
      }

      const transport = latest.current;
      switch (event.key) {
        case ' ':
          transport.onTogglePlay();
          break;
        case 'ArrowRight':
          transport.onStepForward();
          break;
        case 'ArrowLeft':
          transport.onStepBack();
          break;
        case 'ArrowDown':
          transport.onStepOver();
          break;
        case 'ArrowUp':
          transport.onStepOut();
          break;
        case 'Home':
          transport.onSeekToStart();
          break;
        case 'End':
          transport.onSeekToEnd();
          break;
        default:
          return;
      }

      event.preventDefault();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
