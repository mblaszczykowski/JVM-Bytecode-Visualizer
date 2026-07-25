import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { exampleOptions } from './__fixtures__/factorial-run';
import { ExamplePicker } from './ExamplePicker';

/** The four options App builds from the shipped manifest, names included. */
const examples = exampleOptions();

describe('ExamplePicker', () => {
  it('renders the examples it is given', () => {
    render(
      <ExamplePicker examples={examples} selectedId={undefined} onExampleSelected={vi.fn()} />,
    );

    expect(screen.getByRole('radiogroup', { name: 'Example programs' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(examples.length);
    expect(screen.getByRole('radio', { name: 'Fibonacci' })).toBeInTheDocument();
  });

  it('marks the selected example', () => {
    render(<ExamplePicker examples={examples} selectedId="gcd" onExampleSelected={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'GCD', checked: true })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Factorial', checked: false })).toBeInTheDocument();
  });

  it('keeps one tab stop and moves the focus with the arrow keys', () => {
    const onExampleSelected = vi.fn();
    render(
      <ExamplePicker examples={examples} selectedId="gcd" onExampleSelected={onExampleSelected} />,
    );

    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '-1',
      '0',
    ]);

    fireEvent.keyDown(screen.getByRole('radio', { name: 'GCD' }), { key: 'ArrowRight' });

    // Wraps round to the first option, and selection does not follow focus: opening an
    // example parses and runs a whole class file.
    expect(screen.getAllByRole('radio')[0]).toHaveFocus();
    expect(onExampleSelected).not.toHaveBeenCalled();
  });

  it('reports the id of the example that was clicked', () => {
    const onExampleSelected = vi.fn();
    render(
      <ExamplePicker
        examples={examples}
        selectedId="factorial"
        onExampleSelected={onExampleSelected}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: 'Sum of products' }));

    expect(onExampleSelected).toHaveBeenCalledWith('sum-of-products');
  });
});
