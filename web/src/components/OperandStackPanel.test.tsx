import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import {
  firstStepOf as bubbleSortStepOf,
  frameAt as bubbleSortFrameAt,
  heapAt,
  operandRolesAt as bubbleSortRolesAt,
} from './__fixtures__/bubble-sort-run';
import {
  externalsAt,
  firstInternedStep,
  frameAt as collatzFrameAt,
} from './__fixtures__/collatz-run';
import { firstStepOf, frameAt, operandRolesAt, snapshots } from './__fixtures__/factorial-run';
import { OperandStackPanel } from './OperandStackPanel';

const isubStep = firstStepOf('isub');
const frameWithValues = frameAt(isubStep);

const arrayReadStep = bubbleSortStepOf('iaload');

const nullReferenceFrame: StackFrame = {
  methodName: 'sortedMinimum',
  methodDescriptor: '()I',
  pc: 0,
  operandStack: [-1],
  operandKinds: ['ref'],
  locals: [],
  localNames: [],
};

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
    expect(screen.getByText(/instructions push them/)).toBeInTheDocument();
    expect(screen.getByText('BASE')).toBeInTheDocument();
  });

  it('shows the missing frame of the terminal snapshot', () => {
    render(<OperandStackPanel frame={undefined} />);

    expect(screen.getByText('no active frame')).toBeInTheDocument();
    expect(screen.getByText(/belongs to a frame/)).toBeInTheDocument();
  });

  it('names the array a reference cell points at instead of showing its handle', () => {
    render(
      <OperandStackPanel
        frame={bubbleSortFrameAt(arrayReadStep)}
        heap={heapAt(arrayReadStep)}
        annotations={bubbleSortRolesAt(arrayReadStep)}
      />,
    );

    const top = within(cellAt(0));
    const below = within(cellAt(1));
    expect(top.getByText('→ index')).toBeInTheDocument();
    expect(top.queryByTestId('ref-chip')).not.toBeInTheDocument();
    expect(below.getByTestId('ref-chip')).toHaveTextContent('int[5]@0');
    expect(below.getByText('→ array')).toBeInTheDocument();
  });

  it('calls a reference that points at no object null', () => {
    render(<OperandStackPanel frame={nullReferenceFrame} />);

    expect(within(cellAt(0)).getByTestId('ref-chip')).toHaveTextContent('null');
  });

  it('names a standard-library object getstatic interned rather than its handle', () => {
    const step = firstInternedStep();
    render(<OperandStackPanel frame={collatzFrameAt(step)} externals={externalsAt(step)} />);

    expect(within(cellAt(0)).getByTestId('ref-chip')).toHaveTextContent('System.out');
    expect(within(cellAt(0)).queryByText('0')).not.toBeInTheDocument();
  });

  describe('where a value came from', () => {
    it('seeks to the step that pushed the cell', () => {
      const onSeekToStep = vi.fn();
      render(<OperandStackPanel frame={frameWithValues} onSeekToStep={onSeekToStep} />);

      expect(frameWithValues?.operandOrigins).toEqual([5, 6, 7]);
      fireEvent.click(within(cellAt(0)).getByRole('button'));

      expect(onSeekToStep).toHaveBeenCalledWith(7);
    });

    it('names the value and the destination for a screen reader', () => {
      render(<OperandStackPanel frame={frameWithValues} onSeekToStep={vi.fn()} />);

      expect(
        within(cellAt(0)).getByRole('button', { name: 'Go to step 8, where 1 was pushed' }),
      ).toBeInTheDocument();
    });

    it('says what a reference cell is rather than the handle it holds', () => {
      const step = bubbleSortStepOf('iaload');
      render(
        <OperandStackPanel
          frame={bubbleSortFrameAt(step)}
          heap={heapAt(step)}
          onSeekToStep={vi.fn()}
        />,
      );

      expect(
        within(cellAt(1)).getByRole('button', { name: /where int\[5\]@0 was pushed/ }),
      ).toBeInTheDocument();
    });

    it('names an interned object in the accessible name, not the handle it holds', () => {
      const step = firstInternedStep();
      render(
        <OperandStackPanel
          frame={collatzFrameAt(step)}
          externals={externalsAt(step)}
          onSeekToStep={vi.fn()}
        />,
      );

      expect(
        within(cellAt(0)).getByRole('button', { name: /where System\.out was pushed/ }),
      ).toBeInTheDocument();
    });

    it('offers nothing on a cell whose origin the frame does not carry', () => {
      render(<OperandStackPanel frame={nullReferenceFrame} onSeekToStep={vi.fn()} />);

      expect(screen.queryByTestId('operand-origin')).not.toBeInTheDocument();
    });

    it('renders no affordance at all without a way to seek', () => {
      render(<OperandStackPanel frame={frameWithValues} annotations={operandRolesAt(isubStep)} />);

      expect(screen.queryByTestId('operand-origin')).not.toBeInTheDocument();
      expect(within(screen.getByRole('list')).queryByRole('button')).not.toBeInTheDocument();
    });

    it('never points at the step being viewed', () => {
      for (const [step] of snapshots().entries()) {
        const view = render(<OperandStackPanel frame={frameAt(step)} onSeekToStep={vi.fn()} />);

        for (const button of screen.queryAllByTestId('operand-origin')) {
          const target = Number(/from (\d+)/.exec(button.textContent)?.[1]) - 1;
          expect(target).toBeLessThan(step);
        }
        view.unmount();
      }
    });

    it('takes one tab stop and moves the focus down the stack with the arrow keys', () => {
      render(<OperandStackPanel frame={frameWithValues} onSeekToStep={vi.fn()} />);

      const top = within(cellAt(0)).getByTestId('operand-origin');
      const below = within(cellAt(1)).getByTestId('operand-origin');
      expect(top).toHaveAttribute('tabindex', '0');
      expect(below).toHaveAttribute('tabindex', '-1');

      fireEvent.keyDown(top, { key: 'ArrowDown' });

      expect(below).toHaveFocus();
    });
  });
});
