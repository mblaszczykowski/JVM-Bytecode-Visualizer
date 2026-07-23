import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import { mockSnapshotAt } from './__fixtures__/mock-history';
import { OperandStackPanel } from './OperandStackPanel';

/** Step 8 of the mock: factorial(2) just before `isub`, stack [2, 2, 1] from base to top. */
const frameWithValues = mockSnapshotAt(8).callStack.at(-1);

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
    render(
      <OperandStackPanel
        frame={frameWithValues}
        annotations={['waiting for imul', '→ left', '→ right']}
      />,
    );

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
