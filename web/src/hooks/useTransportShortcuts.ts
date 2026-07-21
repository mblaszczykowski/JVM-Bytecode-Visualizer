import { useEffect, useRef } from 'react';

export interface TransportShortcuts {
  /** Off while there is no history to move through. */
  readonly enabled: boolean;
  readonly onTogglePlay: () => void;
  readonly onStepForward: () => void;
  readonly onStepBack: () => void;
  readonly onSeekToStart: () => void;
  readonly onSeekToEnd: () => void;
}

/**
 * True when the focused element deals with the key itself: text entry of any kind, and the
 * space bar on a button or link, which the browser turns into a click. Stealing those would
 * either swallow typing or fire the transport twice for one press.
 */
export function handlesKeyItself(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  // Matches the editable host itself and any element nested inside it.
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
      return false;
  }
}

/**
 * Space plays and pauses, arrows step, Home/End jump to the ends of the history.
 *
 * The callbacks are read through a ref rather than listed as dependencies: every one of them
 * changes identity on every step, and at 8× that would tear down and re-register the window
 * listener a dozen times a second. The subscription depends on `enabled` alone; a key press
 * always reaches the newest callbacks because it happens between renders, never during one.
 */
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
        case 'Home':
          transport.onSeekToStart();
          break;
        case 'End':
          transport.onSeekToEnd();
          break;
        default:
          return;
      }

      // Only after a key was handled: space scrolls the page and arrows scroll panels.
      event.preventDefault();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
