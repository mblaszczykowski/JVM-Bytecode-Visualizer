import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import { mockSnapshotAt } from './__fixtures__/mock-history';
import { LocalsPanel } from './LocalsPanel';

/** Step 0 of the mock: frame `main`, slot 0 is the `args` sentinel, slot 1 not assigned yet. */
const mainFrame = mockSnapshotAt(0).callStack.at(-1);

/** A file compiled without `-g` has no LocalVariableTable, so only slot numbers remain. */
const frameWithoutNames: StackFrame = {
  methodName: 'factorial',
  methodDescriptor: '(I)I',
  pc: 0,
  operandStack: [],
  locals: [7, undefined],
  localNames: [],
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
    render(<LocalsPanel frame={mockSnapshotAt(18).callStack.at(-1)} />);

    const row = within(slotAt(1));

    expect(row.getByText('result')).toBeInTheDocument();
    expect(row.getByText(': I')).toBeInTheDocument();
    expect(row.getByText('2')).toBeInTheDocument();
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

  it('shows the missing frame of the terminal snapshot', () => {
    render(<LocalsPanel frame={undefined} />);

    expect(screen.queryByTestId('local-slot')).not.toBeInTheDocument();
    expect(screen.getByText('No active frame.')).toBeInTheDocument();
  });
});
