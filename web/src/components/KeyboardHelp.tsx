import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { handlesKeyItself } from '../hooks/useTransportShortcuts';

export interface Shortcut {
  /** Rendered as separate keycaps, so `['Shift', '→']` reads as a chord. */
  readonly keys: readonly string[];
  readonly label: string;
}

export interface ShortcutGroup {
  readonly title: string;
  readonly shortcuts: readonly Shortcut[];
}

interface KeyboardHelpProps {
  /** Supplied by the caller so this sheet cannot drift from the handlers that are installed. */
  readonly groups: readonly ShortcutGroup[];
}

function Keycap({ label }: { readonly label: string }) {
  return (
    <kbd className="rounded-[5px] bg-raised-active px-[6px] py-[2px] font-mono text-micro text-fg shadow-control-raised">
      {label}
    </kbd>
  );
}

function HelpSheet({ groups, onClose }: KeyboardHelpProps & { readonly onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    sheetRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    // Capture phase: the transport listens on the window and would scrub the run behind the
    // sheet. Everything this dialog does not use is swallowed rather than forwarded.
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        event.stopPropagation();
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[16px] sm:p-[28px]">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-scrim" />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        data-testid="keyboard-help"
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-[520px] flex-col overflow-hidden rounded-panel bg-overlay shadow-overlay outline-none"
      >
        <header className="flex shrink-0 items-baseline justify-between gap-3 px-[18px] pt-[16px] pb-[12px]">
          <h2 id="shortcuts-title" className="text-title font-semibold text-fg">
            Keyboard
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring shrink-0 rounded-control bg-raised px-3 py-1 text-label text-fg-2 transition-colors hover:bg-raised-active"
          >
            Close
          </button>
        </header>

        <div className="scroll-slim min-h-0 flex-1 overflow-auto px-[14px] pb-[14px]">
          {groups.map((group) => (
            <section key={group.title} className="mt-[4px] mb-[12px] last:mb-0">
              <h3 className="px-[4px] pb-[6px] text-meta font-semibold text-fg-3">{group.title}</h3>
              <ul className="rounded-panel bg-raised px-[14px] py-[6px] shadow-panel">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.label}
                    className="flex items-center justify-between gap-4 py-[7px]"
                  >
                    <span className="text-body text-fg-2">{shortcut.label}</span>
                    <span className="flex shrink-0 items-center gap-[4px]">
                      {shortcut.keys.map((key) => (
                        <Keycap key={key} label={key} />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The shortcuts, behind `?`.
 *
 * The app has had a keyboard since the transport existed and no way to discover it. `?` is the
 * conventional door and costs no chrome; the toolbar carries a visible one as well, because a
 * shortcut for finding the shortcuts helps only the people who already knew.
 */
export function KeyboardHelp({ groups }: KeyboardHelpProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== '?' || event.defaultPrevented || event.ctrlKey || event.metaKey) {
        return;
      }
      if (handlesKeyItself(event.target, event.key)) {
        return;
      }
      // Another dialog owns the keyboard while it is up — the glossary, most often.
      if (document.querySelector('[role="dialog"]') !== null) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={() => {
          setIsOpen(true);
        }}
        className="focus-ring flex h-[24px] min-w-[24px] shrink-0 items-center justify-center rounded-control font-mono text-label text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg"
      >
        <span aria-hidden="true">?</span>
      </button>

      {isOpen ? (
        <HelpSheet
          groups={groups}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
