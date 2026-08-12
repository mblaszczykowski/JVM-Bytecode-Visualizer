import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ExternalValue, StackFrame } from '../core/interpreter';

import {
  firstStepOf as bubbleSortStepOf,
  frameAt as bubbleSortFrameAt,
  heapAt,
} from './__fixtures__/bubble-sort-run';
import { frameAt, snapshots } from './__fixtures__/factorial-run';
import { LocalsPanel } from './LocalsPanel';

const sortingStep = bubbleSortStepOf('iaload');

const mainFrame = frameAt(0);

const finishedMainFrame = frameAt(snapshots().length - 2);

const frameWithoutNames: StackFrame = {
  methodName: 'factorial',
  methodDescriptor: '(I)I',
  pc: 0,
  operandStack: [],
  locals: [7, undefined],
  localNames: [],
};

const externals: readonly ExternalValue[] = [
  { className: 'java/io/PrintStream', label: 'System.out' },
];

const internedFrame: StackFrame = {
  methodName: 'print',
  methodDescriptor: '()V',
  pc: 4,
  operandStack: [],
  locals: [5, 0],
  localNames: ['n', 'out'],
  localKinds: ['int', 'external'],
  localOrigins: [1, 2],
};

function slotAt(index: number): HTMLElement {
  const slot = screen.getAllByTestId('local-slot')[index];
  if (slot === undefined) {
    throw new Error(`No slot rendered at index ${String(index)}`);
  }
  return slot;
}

describe('LocalsPanel', () => {
  it('renders the slot number, the name from the LocalVariableTable and the value', () => {
    render(<LocalsPanel frame={finishedMainFrame} />);

    const row = within(slotAt(1));

    expect(row.getByText('result')).toBeInTheDocument();
    expect(row.getByText(': I')).toBeInTheDocument();
    expect(row.getByText('24')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Locals' })).toBeInTheDocument();
  });

  it('marks an uninitialised slot without a value and without a type', () => {
    render(<LocalsPanel frame={mainFrame} />);

    expect(screen.getAllByTestId('local-slot')).toHaveLength(2);
    expect(within(slotAt(1)).getByText('·')).toBeInTheDocument();
    expect(within(slotAt(1)).queryByText(': I')).not.toBeInTheDocument();
  });

  it('falls back to "slot N" when the variable name is unavailable', () => {
    render(<LocalsPanel frame={frameWithoutNames} />);

    expect(within(slotAt(0)).getByText('slot 0')).toBeInTheDocument();
    expect(within(slotAt(0)).getByText('7')).toBeInTheDocument();
    expect(within(slotAt(1)).getByText('slot 1')).toBeInTheDocument();
  });

  it('shows a reference slot as the array it points at, typed int[]', () => {
    render(<LocalsPanel frame={bubbleSortFrameAt(sortingStep)} heap={heapAt(sortingStep)} />);

    const array = within(slotAt(0));
    expect(array.getByText('a')).toBeInTheDocument();
    expect(array.getByText(': int[]')).toBeInTheDocument();
    expect(array.getByTestId('ref-chip')).toHaveTextContent('int[5]@0');

    const counter = within(slotAt(1));
    expect(counter.getByText(': I')).toBeInTheDocument();
    expect(counter.queryByTestId('ref-chip')).not.toBeInTheDocument();
  });

  it('names a slot holding a standard-library object rather than its handle', () => {
    render(<LocalsPanel frame={internedFrame} externals={externals} onSeekToStep={vi.fn()} />);

    const slot = within(slotAt(1));
    expect(slot.getByTestId('ref-chip')).toHaveTextContent('System.out');
    expect(slot.queryByText('0')).not.toBeInTheDocument();
    expect(slot.queryByText(': I')).not.toBeInTheDocument();
    expect(
      slot.getByRole('button', { name: 'Go to step 3, where out was set to System.out' }),
    ).toBeInTheDocument();
  });

  it('shows the missing frame of the terminal snapshot', () => {
    render(<LocalsPanel frame={undefined} />);

    expect(screen.queryByTestId('local-slot')).not.toBeInTheDocument();
    expect(screen.getByText('no active frame')).toBeInTheDocument();
    expect(screen.getByText(/Local variables belong to a frame/)).toBeInTheDocument();
  });

  it('explains a method that keeps nothing in a local slot', () => {
    render(<LocalsPanel frame={{ ...frameWithoutNames, locals: [] }} />);

    expect(screen.queryByTestId('local-slot')).not.toBeInTheDocument();
    expect(screen.getByText('no local slots')).toBeInTheDocument();
    expect(screen.getByText(/works entirely on the operand stack/)).toBeInTheDocument();
  });

  describe('where a value came from', () => {
    it('seeks to the step that last wrote the slot', () => {
      const onSeekToStep = vi.fn();
      render(<LocalsPanel frame={finishedMainFrame} onSeekToStep={onSeekToStep} />);

      expect(finishedMainFrame?.localOrigins?.[1]).toBe(37);
      fireEvent.click(within(slotAt(1)).getByRole('button'));

      expect(onSeekToStep).toHaveBeenCalledWith(37);
    });

    it('names the variable, the value and the destination for a screen reader', () => {
      render(<LocalsPanel frame={finishedMainFrame} onSeekToStep={vi.fn()} />);

      expect(
        screen.getByRole('button', { name: 'Go to step 38, where result was set to 24' }),
      ).toBeInTheDocument();
    });

    it('says what a reference slot points at rather than the handle it holds', () => {
      render(
        <LocalsPanel
          frame={bubbleSortFrameAt(sortingStep)}
          heap={heapAt(sortingStep)}
          onSeekToStep={vi.fn()}
        />,
      );

      expect(
        within(slotAt(0)).getByRole('button', { name: /where a was set to int\[5\]@0/ }),
      ).toBeInTheDocument();
    });

    it('offers nothing on a slot nothing has written yet', () => {
      render(<LocalsPanel frame={mainFrame} onSeekToStep={vi.fn()} />);

      expect(screen.getAllByTestId('local-slot')).toHaveLength(2);
      expect(screen.queryByTestId('local-origin')).not.toBeInTheDocument();
    });

    it('offers only the slots that were written', () => {
      render(<LocalsPanel frame={finishedMainFrame} onSeekToStep={vi.fn()} />);

      expect(within(slotAt(0)).queryByTestId('local-origin')).not.toBeInTheDocument();
      expect(within(slotAt(1)).getByTestId('local-origin')).toBeInTheDocument();
    });

    it('renders no affordance at all without a way to seek', () => {
      render(<LocalsPanel frame={finishedMainFrame} />);

      expect(screen.queryByTestId('local-origin')).not.toBeInTheDocument();
      expect(within(screen.getByRole('list')).queryByRole('button')).not.toBeInTheDocument();
    });

    it('never points at the step being viewed', () => {
      for (const [step] of snapshots().entries()) {
        const view = render(<LocalsPanel frame={frameAt(step)} onSeekToStep={vi.fn()} />);

        for (const button of screen.queryAllByTestId('local-origin')) {
          const target = Number(/from (\d+)/.exec(button.textContent)?.[1]) - 1;
          expect(target).toBeLessThan(step);
        }
        view.unmount();
      }
    });

    it('takes one tab stop and moves the focus down the slots with the arrow keys', () => {
      render(<LocalsPanel frame={bubbleSortFrameAt(sortingStep)} onSeekToStep={vi.fn()} />);

      const first = within(slotAt(0)).getByTestId('local-origin');
      const second = within(slotAt(1)).getByTestId('local-origin');
      expect(first).toHaveAttribute('tabindex', '0');
      expect(second).toHaveAttribute('tabindex', '-1');

      fireEvent.keyDown(first, { key: 'ArrowDown' });

      expect(second).toHaveFocus();
    });
  });
});
