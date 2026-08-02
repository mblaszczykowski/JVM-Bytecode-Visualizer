import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import {
  firstStepOf as bubbleSortStepOf,
  frameAt as bubbleSortFrameAt,
  heapAt,
  operandRolesAt as bubbleSortRolesAt,
} from './__fixtures__/bubble-sort-run';
import { firstStepOf, frameAt, operandRolesAt } from './__fixtures__/factorial-run';
import { OperandStackPanel } from './OperandStackPanel';

/** factorial(4) just before its `isub`: the stack holds [4, 4, 1] from base to top. */
const isubStep = firstStepOf('isub');
const frameWithValues = frameAt(isubStep);

/** The first `iaload` of the sort: an array reference with the index to read on top of it. */
const arrayReadStep = bubbleSortStepOf('iaload');

/** A reference to nothing — `aconst_null` leaves exactly this on the stack. */
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
    // Step 0 is a frame people screenshot: it says what would put something here.
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

    // `…, arrayref, index` — the index is on top, the reference right under it.
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
});
