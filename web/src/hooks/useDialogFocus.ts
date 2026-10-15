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

function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.closest('[hidden], [inert]') !== null) {
    return false;
  }
  if (getComputedStyle(element).visibility === 'hidden') {
    return false;
  }
  for (
    let ancestor: HTMLElement | null = element;
    ancestor !== null;
    ancestor = ancestor.parentElement
  ) {
    if (getComputedStyle(ancestor).display === 'none') {
      return false;
    }
  }
  return true;
}

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
      if (dialog === null || openDialogs.at(-1) !== ref || event.defaultPrevented) {
        return;
      }

      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isTabbable);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first === undefined || last === undefined) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const outside = !dialog.contains(document.activeElement);
        const leaving =
          outside ||
          (event.shiftKey
            ? document.activeElement === first || document.activeElement === dialog
            : document.activeElement === last || document.activeElement === dialog);
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
