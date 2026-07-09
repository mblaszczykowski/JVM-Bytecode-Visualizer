import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockFactorialMethod, mockUnsupportedMethod } from './__fixtures__/mock-history';
import { BytecodePanel } from './BytecodePanel';

function renderFactorial(currentOffset: number | undefined) {
  return render(
    <BytecodePanel
      methodName={mockFactorialMethod.name}
      methodDescriptor={mockFactorialMethod.descriptor}
      instructions={mockFactorialMethod.instructions}
      currentOffset={currentOffset}
    />,
  );
}

describe('BytecodePanel', () => {
  it('renderuje listing bieżącej metody wraz z sygnaturą', () => {
    renderFactorial(undefined);

    expect(screen.getByRole('region', { name: 'Bajtkod' })).toBeInTheDocument();
    expect(screen.getByText('factorial(I)I')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(mockFactorialMethod.instructions.length);
  });

  it('podświetla instrukcję pod pc wierzchniej ramki', () => {
    renderFactorial(11);

    const current = screen.getByTestId('current-instruction');

    expect(current).toHaveAttribute('data-offset', '11');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('invokestatic');
    expect(screen.getAllByTestId('current-instruction')).toHaveLength(1);
  });

  it('nie podświetla niczego, gdy stos wywołań jest pusty', () => {
    renderFactorial(undefined);

    expect(screen.queryByTestId('current-instruction')).not.toBeInTheDocument();
  });

  it('pokazuje absolutny cel skoku zamiast surowej delty', () => {
    renderFactorial(2);
    const row = within(screen.getByTestId('current-instruction'));

    expect(row.getByText('if_icmpgt')).toBeInTheDocument();
    // Operand w strumieniu to delta 5; cel skoku (2 + 5) to 7 — panel pokazuje 7.
    expect(row.getByText('7')).toBeInTheDocument();
    expect(row.queryByText('5')).not.toBeInTheDocument();
  });

  it('renderuje operand invokestatic jako odwołanie do constant poolu', () => {
    renderFactorial(11);

    expect(within(screen.getByTestId('current-instruction')).getByText('#7')).toBeInTheDocument();
  });

  it('oznacza instrukcje spoza zakresu MVP jako unsupported', () => {
    render(
      <BytecodePanel
        methodName={mockUnsupportedMethod.name}
        methodDescriptor={mockUnsupportedMethod.descriptor}
        instructions={mockUnsupportedMethod.instructions}
        currentOffset={0}
      />,
    );

    expect(screen.getAllByText('unsupported')).toHaveLength(2);
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('getstatic');
  });
});
