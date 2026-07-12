import { Segment, SegmentedControl } from './ui/SegmentedControl';

export interface ExampleOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

interface ExamplePickerProps {
  readonly examples: readonly ExampleOption[];
  readonly selectedId: string | undefined;
  /** Loading the example's `.class` happens upstream — only the identifier travels here. */
  readonly onExampleSelected: (id: string) => void;
}

export function ExamplePicker({ examples, selectedId, onExampleSelected }: ExamplePickerProps) {
  return (
    <SegmentedControl label="Example programs">
      {examples.map((example) => (
        <Segment
          key={example.id}
          label={example.name}
          labelIsVisible
          title={example.description}
          selected={example.id === selectedId}
          onClick={() => {
            onExampleSelected(example.id);
          }}
        >
          {example.name}
        </Segment>
      ))}
    </SegmentedControl>
  );
}
