import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDialogFocus } from '../hooks/useDialogFocus';
import { handlesKeyItself } from '../hooks/useTransportShortcuts';

import { Button } from './ui/Button';

export interface Shortcut {
  readonly keys: readonly string[];
  readonly label: string;
}

export interface ShortcutGroup {
  readonly title: string;
  readonly shortcuts: readonly Shortcut[];
}

interface KeyboardHelpProps {
  readonly groups: readonly ShortcutGroup[];
}

function Keycap({ label }: { readonly label: string }) {
  return (
    <kbd className="rounded-code bg-raised-active px-1.5 py-0.5 font-mono text-micro text-fg shadow-control-raised">
      {label}
    </kbd>
  );
}

function HelpSheet({ groups, onClose }: KeyboardHelpProps & { readonly onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useDialogFocus(sheetRef, onClose);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-7">
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
        <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 pt-4 pb-3">
          <h2 id="shortcuts-title" className="text-title font-medium text-fg">
            Keyboard
          </h2>
          <Button tone="raised" onClick={onClose} className="shrink-0">
            Close
          </Button>
        </div>

        <div className="scroll-slim min-h-0 flex-1 overflow-auto px-3.5 pb-3.5">
          {groups.map((group) => (
            <section key={group.title} className="mt-1 mb-3 last:mb-0">
              <h3 className="px-1 pb-1.5 text-meta font-medium text-fg-3">{group.title}</h3>
              <ul className="rounded-panel bg-raised px-3.5 py-1.5 shadow-panel">
                {group.shortcuts.map((shortcut) => (
                  <li
                    key={shortcut.label}
                    className="flex items-center justify-between gap-4 py-1.5"
                  >
                    <span className="text-body text-fg-2">{shortcut.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
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
