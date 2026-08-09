import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { exampleOptions } from './__fixtures__/factorial-run';
import { ExamplePicker } from './ExamplePicker';

const examples = exampleOptions();

const last = examples[examples.length - 1] ?? { id: '', name: '' };

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
      <ExamplePicker
        examples={examples}
        selectedId={last.id}
        onExampleSelected={onExampleSelected}
      />,
    );

    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.getAttribute('tabindex'))).toEqual(
      examples.map((_, index) => (index === examples.length - 1 ? '0' : '-1')),
    );

    fireEvent.keyDown(screen.getByRole('radio', { name: last.name }), { key: 'ArrowRight' });

    expect(screen.getAllByRole('radio')[0]).toHaveFocus();
    expect(onExampleSelected).not.toHaveBeenCalled();
  });

  it('keeps the options on one scrolling rail at every width', () => {
    render(<ExamplePicker examples={examples} selectedId="gcd" onExampleSelected={vi.fn()} />);

    const rail = screen.getByRole('radiogroup', { name: 'Example programs' }).parentElement;
    expect(rail?.className).toContain('overflow-x-auto');
    expect(rail?.className).not.toContain('md:overflow-visible');
    expect(rail?.className).toContain('fade-x');
    expect(rail?.className).toContain('snap-x');
    expect(screen.getByRole('radio', { name: 'GCD' }).className).toContain('snap-start');
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
