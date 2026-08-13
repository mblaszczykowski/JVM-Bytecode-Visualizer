import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const TRANSPORT_KEYS: ReadonlySet<string> = new Set([
  ' ',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
]);

export interface DialogFocusOptions {
  readonly active?: boolean;
  readonly initialFocus?: RefObject<HTMLElement | null> | undefined;
}

const openDialogs: RefObject<HTMLElement | null>[] = [];

export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { active = true, initialFocus }: DialogFocusOptions = {},
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const opener = document.activeElement;
    (initialFocus?.current ?? ref.current)?.focus();

    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, [active, ref, initialFocus]);

  useEffect(() => {
    if (!active) {
      return;
    }
    openDialogs.push(ref);

    return () => {
      const index = openDialogs.lastIndexOf(ref);
      if (index !== -1) {
        openDialogs.splice(index, 1);
      }
    };
  }, [active, ref]);

  useEffect(() => {
    if (!active) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      const dialog = ref.current;
      if (dialog === null) {
        return;
      }

      if (event.key === 'Escape') {
        if (openDialogs.at(-1) !== ref) {
          return;
        }
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (element) => element.tabIndex >= 0,
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first === undefined || last === undefined) {
          return;
        }
        const leaving = event.shiftKey
          ? document.activeElement === first || document.activeElement === dialog
          : document.activeElement === last;
        if (leaving) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
        return;
      }

      if (TRANSPORT_KEYS.has(event.key)) {
        event.stopPropagation();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, ref, onClose]);
}
