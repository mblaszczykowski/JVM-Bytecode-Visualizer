import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

export interface ExampleOption {
  readonly id: string;
  readonly name: string;
  /** One line for the card on the welcome screen. */
  readonly tagline: string;
  /** The longer text; too much for a segment, so it lives in the tooltip. */
  readonly description: string;
}

interface ExamplePickerProps {
  readonly examples: readonly ExampleOption[];
  readonly selectedId: string | undefined;
  /** Loading the example's `.class` happens upstream — only the identifier travels here. */
  readonly onExampleSelected: (id: string) => void;
  /**
   * Below `md`, fold the rail behind the name of the loaded program.
   *
   * Set only once there is a program on screen, which is also when the panel switch appears.
   * Choosing which program to look at happens about once a session; choosing which panel is on
   * screen happens constantly, and on a 390px phone the two were taking a row each at the top
   * while the disassembly got 64% of the height. Frequency of use is what earns permanent
   * space, so the rail gives its row up and the panel switch keeps one.
   *
   * The rail is folded, never duplicated: there is one radiogroup in the document at any width,
   * so a screen reader and a test both find exactly one control for "which example".
   */
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

/*
 * Picking an example is navigation, and navigation recedes. Only the loaded one carries a
 * surface; the rest are text. Eight filled pills in a recessed rail used to be the loudest
 * object on the screen, which put the emphasis on the menu rather than on the program.
 */
const SELECTED = 'bg-raised-active text-fg';
const RESTING = 'text-fg-2 hover:bg-raised hover:text-fg';

/**
 * The bundled programs, one of them loaded: that is a single value with as many options as
 * there are examples, so it is a radio group rather than a row of independent toggles.
 * `aria-pressed` on each would have said "the others are off", which is not what a reader
 * needs to hear.
 *
 * Roving tabindex, as the pattern requires: one tab stop for the group, arrows inside it.
 * Selection does not follow focus here — picking an option parses and runs a whole class
 * file, which is too much to do once per choice while someone arrows past them.
 */
export function ExamplePicker({
  examples,
  selectedId,
  onExampleSelected,
  collapsible = false,
}: ExamplePickerProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  /** Only ever true below `md`; above it the rail is open by CSS and this is ignored. */
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | undefined>(undefined);
  const selectedIndex = examples.findIndex((example) => example.id === selectedId);
  // Nothing loaded yet: the first option is the way in.
  const anchorIndex = focusedIndex ?? (selectedIndex < 0 ? 0 : selectedIndex);

  // A sheet has to close on Escape wherever the focus happens to be.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const step = MOVES[event.key];
    if (step === undefined || examples.length === 0) {
      return;
    }
    // Also keeps the arrow keys from stepping the run while the toolbar has the focus.
    event.preventDefault();

    const next = (index + step + examples.length) % examples.length;
    setFocusedIndex(next);
    groupRef.current?.querySelectorAll('button')[next]?.focus();
  }

  const selectedName = examples.find((example) => example.id === selectedId)?.name;

  /*
   * A rail that scrolls at every width from `md` up. Eight examples are some 600px of options,
   * and letting them lay themselves out is what used to push the toolbar into a second and a
   * third row between 768px and 1300px. The cost is the options that fall off the end, and the
   * fade is what says they are there.
   *
   * The mask stays honest: the rail carries no surface of its own, so where the options fit it
   * falls on empty space and nothing reads as cut off. `pr-7` is the room the last option needs
   * to clear the mask at the end of the scroll — the rail has to be a flex container for Chrome
   * to count that padding as scrollable overflow at all — and `scroll-pr-7` keeps the focus ring
   * inside it when the arrow keys reach the last option.
   *
   * The negative margins keep the room for that ring out of the toolbar's row height.
   */
  const RAIL =
    'scroll-slim fade-x -mx-1 -my-1 flex min-w-0 snap-x snap-proximity items-center overflow-x-auto overflow-y-hidden py-1 pl-1 pr-7 scroll-pl-1 scroll-pr-7';

  /*
   * Folded, the same rail becomes a sheet along the bottom edge — where a thumb is — and every
   * one of its `md:` classes hands it straight back to being a rail at the first breakpoint.
   */
  const SHEET =
    'fixed inset-x-0 bottom-0 z-50 max-h-[60dvh] flex-col items-stretch overflow-x-hidden overflow-y-auto rounded-t-panel bg-overlay p-2 pb-[calc(8px+env(safe-area-inset-bottom))] shadow-overlay md:static md:max-h-none md:flex-row md:items-center md:overflow-x-auto md:overflow-y-hidden md:rounded-none md:bg-transparent md:p-0 md:pb-1 md:shadow-none';

  return (
    <>
      {collapsible ? (
        <button
          type="button"
          data-testid="example-picker-trigger"
          aria-expanded={isOpen}
          aria-label={`Example program: ${selectedName ?? 'none'}. Choose another`}
          onClick={() => {
            setIsOpen(true);
          }}
          className="focus-ring text-meta flex min-w-0 shrink items-center gap-1 rounded-control bg-raised px-2.5 py-1 text-fg shadow-control-raised transition-colors duration-150 hover:bg-raised-hover md:hidden"
        >
          <span className="truncate">{selectedName ?? 'Examples'}</span>
          <ChevronIcon />
        </button>
      ) : null}

      {collapsible && isOpen ? (
        <div
          aria-hidden="true"
          onClick={() => {
            setIsOpen(false);
          }}
          className="fixed inset-0 z-40 bg-scrim md:hidden"
        />
      ) : null}

      <div
        className={collapsible ? (isOpen ? `${RAIL} ${SHEET}` : `hidden md:flex ${RAIL}`) : RAIL}
      >
        <div
          ref={groupRef}
          role="radiogroup"
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
                role="radio"
                aria-checked={isSelected}
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
                  isSelected ? SELECTED : RESTING
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
