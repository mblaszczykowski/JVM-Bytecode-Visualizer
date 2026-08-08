import { type KeyboardEvent, useRef, useState } from 'react';

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
export function ExamplePicker({ examples, selectedId, onExampleSelected }: ExamplePickerProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | undefined>(undefined);
  const selectedIndex = examples.findIndex((example) => example.id === selectedId);
  // Nothing loaded yet: the first option is the way in.
  const anchorIndex = focusedIndex ?? (selectedIndex < 0 ? 0 : selectedIndex);

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

  return (
    /*
     * A rail that scrolls at every width, not only below `md`. Eight examples are some 600px
     * of options, and letting them lay themselves out above `md` is what used to push the
     * toolbar into a second and a third row between 768px and 1300px. The cost is the options
     * that fall off the end, and the fade is what says they are there.
     *
     * The mask stays honest: the rail carries no surface of its own, so where the options fit
     * it falls on empty space and nothing reads as cut off. `pr-7` is the room the last option
     * needs to clear the mask at the end of the scroll — the rail has to be a flex container
     * for Chrome to count that padding as scrollable overflow at all — and `scroll-pr-7`
     * keeps the focus ring inside it when the arrow keys reach the last option.
     *
     * The negative margins keep the room for that ring out of the toolbar's row height.
     */
    <div className="scroll-slim fade-x -mx-1 -my-1 flex min-w-0 snap-x snap-proximity items-center overflow-x-auto overflow-y-hidden py-1 pl-1 pr-7 scroll-pl-1 scroll-pr-7">
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label="Example programs"
        className="inline-flex shrink-0 items-center gap-px"
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
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, index);
              }}
              className={`focus-ring text-meta flex shrink-0 snap-start items-center justify-center rounded-control px-2.5 py-1 transition-colors duration-150 ${
                isSelected ? SELECTED : RESTING
              }`}
            >
              {example.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MOVES: Readonly<Record<string, number | undefined>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};
