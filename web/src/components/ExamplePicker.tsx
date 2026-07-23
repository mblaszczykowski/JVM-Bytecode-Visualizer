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

const SELECTED = 'bg-white/[0.18] text-white/95 shadow-control-raised';
const RESTING = 'text-white/52 hover:text-white/85';

/**
 * Four programs, one of them loaded: that is a single value with four options, so it is a
 * radio group rather than four independent toggles. `aria-pressed` on each would have said
 * "three of these are off", which is not what a reader needs to hear.
 *
 * Roving tabindex, as the pattern requires: one tab stop for the group, arrows inside it.
 * Selection does not follow focus here — picking an option parses and runs a whole class
 * file, which is too much to do four times while someone arrows past the choices.
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
    // Below the width of four segments the row scrolls instead of pushing the toolbar apart.
    <div className="scroll-slim -mx-1 min-w-0 overflow-x-auto px-1 md:mx-0 md:overflow-visible md:px-0">
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label="Example programs"
        className="inline-flex shrink-0 items-center gap-[3px] rounded-full bg-white/7 p-[3px] shadow-control-inset"
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
              className={`focus-ring flex shrink-0 items-center justify-center rounded-full px-3 py-1 text-[12px] transition-colors ${
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
