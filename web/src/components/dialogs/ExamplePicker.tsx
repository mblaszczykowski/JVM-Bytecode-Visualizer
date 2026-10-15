import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

import { useDialogFocus } from '../../hooks/useDialogFocus';

import { Button } from '../ui/Button';
import { SELECTED_SURFACE } from '../ui/button-surface';

export interface ExampleOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface ExamplePickerProps {
  readonly examples: readonly ExampleOption[];
  readonly selectedId: string | undefined;
  readonly onExampleSelected: (id: string) => void;
  readonly collapsible?: boolean;
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0" aria-hidden="true" focusable="false">
      <path
        d="M3 4.5 6 7.5 9 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const RESTING = 'text-fg-2 hover:bg-raised hover:text-fg';

const RAIL =
  'scroll-slim fade-x -mx-1 -my-1 flex min-w-0 snap-x snap-proximity items-center overflow-x-auto overflow-y-hidden py-1 pl-1 pr-7 scroll-pl-1 scroll-pr-7';

const SHEET =
  'fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] flex-col items-stretch overflow-x-hidden overflow-y-auto rounded-t-panel bg-overlay p-2 pb-[calc(8px+env(safe-area-inset-bottom))] shadow-overlay outline-none md:static md:max-h-none md:flex-row md:items-center md:overflow-x-auto md:overflow-y-hidden md:rounded-none md:bg-transparent md:p-0 md:pb-1 md:shadow-none';

export function ExamplePicker({
  examples,
  selectedId,
  onExampleSelected,
  collapsible = false,
}: ExamplePickerProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | undefined>(undefined);
  const selectedIndex = examples.findIndex((example) => example.id === selectedId);
  const preferredIndex = focusedIndex ?? selectedIndex;
  const anchorIndex =
    preferredIndex >= 0 && preferredIndex < examples.length
      ? preferredIndex
      : Math.max(selectedIndex, 0);
  const isSheet = collapsible && isOpen;

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  useDialogFocus(sheetRef, close, { active: isSheet });

  useEffect(() => {
    if (!collapsible || typeof window.matchMedia !== 'function') {
      return;
    }
    const desktop = window.matchMedia('(min-width: 768px)');
    const changed = (): void => {
      if (desktop.matches) {
        close();
      }
    };
    desktop.addEventListener('change', changed);
    return () => {
      desktop.removeEventListener('change', changed);
    };
  }, [collapsible, close]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const step = MOVES[event.key];
    if (step === undefined || examples.length === 0) {
      return;
    }
    event.preventDefault();

    const next = (index + step + examples.length) % examples.length;
    setFocusedIndex(next);
    groupRef.current?.querySelectorAll('button')[next]?.focus();
  }

  const selectedName = examples.find((example) => example.id === selectedId)?.name;

  return (
    <>
      {collapsible ? (
        <Button
          tone="prominent"
          data-testid="example-picker-trigger"
          aria-expanded={isOpen}
          aria-label={`Example program: ${selectedName ?? 'none'}. Choose another`}
          onClick={() => {
            setIsOpen(true);
          }}
          className="min-w-0 shrink md:hidden"
        >
          <span className="truncate">{selectedName ?? 'Examples'}</span>
          <ChevronIcon />
        </Button>
      ) : null}

      {isSheet ? (
        <div
          aria-hidden="true"
          data-testid="example-picker-scrim"
          onClick={close}
          className="fixed inset-0 z-40 bg-scrim md:hidden"
        />
      ) : null}

      <div
        ref={sheetRef}
        role={isSheet ? 'dialog' : undefined}
        aria-modal={isSheet ? true : undefined}
        aria-label={isSheet ? 'Example programs' : undefined}
        tabIndex={isSheet ? -1 : undefined}
        className={collapsible ? (isOpen ? `${RAIL} ${SHEET}` : `hidden md:flex ${RAIL}`) : RAIL}
      >
        <div
          ref={groupRef}
          role="group"
          aria-label="Example programs"
          className={
            collapsible
              ? 'flex min-w-0 shrink-0 flex-col items-stretch gap-px md:inline-flex md:flex-row md:items-center'
              : 'inline-flex shrink-0 items-center gap-px'
          }
        >
          {examples.map((example, index) => {
            const isSelected = example.id === selectedId;

            return (
              <button
                key={example.id}
                type="button"
                data-testid="example-option"
                aria-pressed={isSelected}
                tabIndex={index === anchorIndex ? 0 : -1}
                title={example.description}
                onClick={() => {
                  onExampleSelected(example.id);
                  setIsOpen(false);
                }}
                onKeyDown={(event) => {
                  handleKeyDown(event, index);
                }}
                className={`focus-ring text-meta flex shrink-0 snap-start items-center justify-center rounded-control px-2.5 py-1.5 transition-colors duration-150 md:py-1 ${
                  isSelected ? SELECTED_SURFACE : RESTING
                }`}
              >
                {example.name}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

const MOVES: Readonly<Record<string, number | undefined>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};
