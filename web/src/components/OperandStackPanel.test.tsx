import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import { firstStepOf, frameAt, operandRolesAt } from './__fixtures__/factorial-run';
import { OperandStackPanel } from './OperandStackPanel';

/** factorial(4) just before its `isub`: the stack holds [4, 4, 1] from base to top. */
const isubStep = firstStepOf('isub');
const frameWithValues = frameAt(isubStep);

const emptyStackFrame: StackFrame = {
  methodName: 'factorial',
  methodDescriptor: '(I)I',
  pc: 0,
  operandStack: [],
  locals: [2],
  localNames: ['n'],
};

function cellAt(position: number): HTMLElement {
  const cell = screen.getAllByTestId('operand-cell')[position];
  if (cell === undefined) {
    throw new Error(`No operand cell rendered at position ${String(position)}`);
  }
  return cell;
}

describe('OperandStackPanel', () => {
  it('renders the top of the stack first and labels it', () => {
    render(<OperandStackPanel frame={frameWithValues} />);

    const cells = screen.getAllByTestId('operand-cell');

    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.dataset.stackIndex)).toEqual(['2', '1', '0']);
    expect(within(cellAt(0)).getByText('TOP')).toBeInTheDocument();
    expect(within(cellAt(0)).getByText('1')).toBeInTheDocument();
  });

  it('annotates each cell with the role it plays for the current instruction', () => {
    // The two operands of `isub`, and below them the `n` that `imul` is still waiting for.
    render(<OperandStackPanel frame={frameWithValues} annotations={operandRolesAt(isubStep)} />);

    expect(within(cellAt(0)).getByText('→ right')).toBeInTheDocument();
    expect(within(cellAt(1)).getByText('→ left')).toBeInTheDocument();
    expect(within(cellAt(2)).getByText('waiting for imul')).toBeInTheDocument();
  });

  it('describes the stack height and closes the stack with a base line', () => {
    render(<OperandStackPanel frame={frameWithValues} />);

    expect(screen.getByRole('region', { name: 'Operand stack' })).toBeInTheDocument();
    expect(screen.getByText('height 3')).toBeInTheDocument();
    expect(screen.getByText('BASE')).toBeInTheDocument();
  });

  it('shows a readable empty state for a frame with no operands', () => {
    render(<OperandStackPanel frame={emptyStackFrame} />);

    expect(screen.queryByTestId('operand-cell')).not.toBeInTheDocument();
    expect(screen.getByText('empty')).toBeInTheDocument();
    expect(screen.getByText('BASE')).toBeInTheDocument();
  });

  it('shows the missing frame of the terminal snapshot', () => {
    render(<OperandStackPanel frame={undefined} />);

    expect(screen.getByText('No active frame.')).toBeInTheDocument();
  });
});
