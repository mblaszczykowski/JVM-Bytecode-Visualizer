import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { mockExamples } from './__fixtures__/mock-history';
import { ExamplePicker } from './ExamplePicker';

describe('ExamplePicker', () => {
  it('renders the examples it is given', () => {
    render(
      <ExamplePicker examples={mockExamples} selectedId={undefined} onExampleSelected={vi.fn()} />,
    );

    expect(screen.getByRole('group', { name: 'Example programs' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(mockExamples.length);
    expect(screen.getByRole('button', { name: 'Fibonacci' })).toBeInTheDocument();
  });

  it('marks the selected example', () => {
    render(<ExamplePicker examples={mockExamples} selectedId="gcd" onExampleSelected={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Gcd', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Factorial', pressed: false })).toBeInTheDocument();
  });

  it('reports the id of the example that was clicked', () => {
    const onExampleSelected = vi.fn();
    render(
      <ExamplePicker
        examples={mockExamples}
        selectedId="factorial"
        onExampleSelected={onExampleSelected}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SumOfSquares' }));

    expect(onExampleSelected).toHaveBeenCalledWith('sum-of-squares');
  });
});
