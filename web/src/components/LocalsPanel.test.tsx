import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StackFrame } from '../core/interpreter/types';

import { mockSnapshotAt } from './__fixtures__/mock-history';
import { LocalsPanel } from './LocalsPanel';

/** Krok 0 mocka: ramka `main`, slot 0 = wartownik `args`, slot 1 = jeszcze nieprzypisany. */
const mainFrame = mockSnapshotAt(0).callStack.at(-1);

/** Plik skompilowany bez `-g` nie ma LocalVariableTable — zostają same numery slotów. */
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
    throw new Error(`Brak wyrenderowanego slotu ${String(index)}`);
  }
  return slot;
}

describe('LocalsPanel', () => {
  it('renderuje slot, nazwę z LocalVariableTable i wartość', () => {
    render(<LocalsPanel frame={mockSnapshotAt(18).callStack.at(-1)} />);

    const row = within(slotAt(1));

    expect(row.getByText('result')).toBeInTheDocument();
    expect(row.getByText('2')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Zmienne lokalne' })).toBeInTheDocument();
  });

  it('pokazuje "—" dla slotu niezainicjalizowanego', () => {
    render(<LocalsPanel frame={mainFrame} />);

    expect(screen.getAllByTestId('local-slot')).toHaveLength(2);
    expect(within(slotAt(1)).getByText('—')).toBeInTheDocument();
  });

  it('używa fallbacku "slot N", gdy nazwa zmiennej jest niedostępna', () => {
    render(<LocalsPanel frame={frameWithoutNames} />);

    expect(within(slotAt(0)).getByText('slot 0')).toBeInTheDocument();
    expect(within(slotAt(0)).getByText('7')).toBeInTheDocument();
    expect(within(slotAt(1)).getByText('slot 1')).toBeInTheDocument();
  });

  it('pokazuje brak ramki dla snapshotu terminalnego', () => {
    render(<LocalsPanel frame={undefined} />);

    expect(screen.queryByTestId('local-slot')).not.toBeInTheDocument();
    expect(screen.getByText('Brak aktywnej ramki.')).toBeInTheDocument();
  });
});
