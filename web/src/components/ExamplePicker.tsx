import { FOCUS_RING } from './theme';

export interface ExampleOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface ExamplePickerProps {
  readonly examples: readonly ExampleOption[];
  readonly selectedId: string | undefined;
  /** Wczytanie `.class` przykładu to Faza 6 — tu leci wyłącznie identyfikator. */
  readonly onExampleSelected: (id: string) => void;
}

export function ExamplePicker({ examples, selectedId, onExampleSelected }: ExamplePickerProps) {
  return (
    <div
      role="group"
      aria-label="Przykładowe programy"
      className="flex items-center gap-[3px] rounded-full bg-white/10 p-[3px] shadow-[inset_0_1px_2px_rgb(0_0_0/0.28)]"
    >
      {examples.map((example) => {
        const isSelected = example.id === selectedId;

        return (
          <button
            key={example.id}
            type="button"
            aria-pressed={isSelected}
            title={example.description}
            onClick={() => {
              onExampleSelected(example.id);
            }}
            className={`rounded-full px-3 py-1 text-[12px] transition-colors ${FOCUS_RING} ${
              isSelected
                ? 'bg-white/20 text-white/95 shadow-[0_1px_4px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.28)]'
                : 'text-white/50 hover:text-white/80'
            }`}
          >
            {example.name}
          </button>
        );
      })}
    </div>
  );
}
