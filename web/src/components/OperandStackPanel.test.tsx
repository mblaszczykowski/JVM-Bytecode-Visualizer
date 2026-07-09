import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import { mockSnapshotAt } from './__fixtures__/mock-history';
import { OperandStackPanel } from './OperandStackPanel';

/** Krok 8 mocka: factorial(2) tuż przed `isub`, stos [2, 2, 1] (dno → wierzch). */
const frameWithValues = mockSnapshotAt(8).callStack.at(-1);

const emptyStackFrame: StackFrame = {
  methodName: 'factorial',
  methodDescriptor: '(I)I',
  pc: 0,
  operandStack: [],
  locals: [2],
  localNames: ['n'],
};

describe('OperandStackPanel', () => {
  it('renderuje wierzch stosu u góry', () => {
    render(<OperandStackPanel frame={frameWithValues} />);

    const cells = screen.getAllByTestId('operand-cell');

    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.getAttribute('data-stack-index'))).toEqual(['2', '1', '0']);
    expect(cells.map((cell) => cell.textContent)).toEqual(['TOP1', '2', '2']);
  });

  it('opisuje wysokość stosu w nagłówku panelu', () => {
    render(<OperandStackPanel frame={frameWithValues} />);

    expect(screen.getByRole('region', { name: 'Stos operandów' })).toBeInTheDocument();
    expect(screen.getByText('wysokość 3')).toBeInTheDocument();
    expect(screen.getByText('BASE')).toBeInTheDocument();
  });

  it('pokazuje czytelny stan pusty dla ramki bez operandów', () => {
    render(<OperandStackPanel frame={emptyStackFrame} />);

    expect(screen.queryByTestId('operand-cell')).not.toBeInTheDocument();
    expect(screen.getByText('Stos pusty.')).toBeInTheDocument();
  });

  it('pokazuje brak ramki dla snapshotu terminalnego', () => {
    render(<OperandStackPanel frame={undefined} />);

    expect(screen.getByText('Brak aktywnej ramki.')).toBeInTheDocument();
  });
});
