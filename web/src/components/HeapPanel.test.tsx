import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  arrayAt,
  firstStepOf,
  frameAt,
  heapAt,
  mnemonicAt,
  terminalStep,
} from './__fixtures__/bubble-sort-run';
import { HeapPanel } from './HeapPanel';

/** The comparison of the first pass: `iaload` reading a[0] out of `{5,3,4,1,2}`. */
const loadStep = firstStepOf('iaload');
/** The first swap: `iastore` writing 3 over a[0]. The array only changes on the next step. */
const storeStep = firstStepOf('iastore', 40);

function cellValues(): string[] {
  return screen.getAllByTestId('heap-cell').map((cell) => cell.textContent);
}

function currentCell(): HTMLElement | undefined {
  return screen.getAllByTestId('heap-cell').find((cell) => cell.dataset.current === 'true');
}

function renderAt(step: number) {
  return render(
    <HeapPanel heap={heapAt(step)} frame={frameAt(step)} mnemonic={mnemonicAt(step)} />,
  );
}

describe('HeapPanel', () => {
  it('renders the allocated array as labelled cells', () => {
    renderAt(loadStep);

    expect(screen.getByRole('region', { name: 'Heap' })).toBeInTheDocument();
    expect(screen.getAllByTestId('heap-array')).toHaveLength(1);
    expect(screen.getByText('int[5]@0')).toBeInTheDocument();
    expect(cellValues()).toEqual(['5', '3', '4', '1', '2']);
    expect(arrayAt(loadStep).elements).toEqual([5, 3, 4, 1, 2]);
  });

  it('marks the element the current instruction reads', () => {
    renderAt(loadStep);

    expect(currentCell()?.dataset.index).toBe('0');
    // Colour is not the only signal: the array says in words which element is being touched.
    expect(screen.getByText('reads index 0')).toBeInTheDocument();
  });

  it('marks the element the current instruction writes', () => {
    renderAt(storeStep);

    expect(currentCell()?.dataset.index).toBe('0');
    expect(screen.getByText('writes index 0')).toBeInTheDocument();
    // The store has not run yet — the snapshot is the state before it.
    expect(cellValues()).toEqual(['5', '3', '4', '1', '2']);
  });

  it('flashes the cell a store rewrote, once, on the step that changed it', () => {
    const view = renderAt(storeStep);
    expect(screen.queryAllByTestId('heap-pulse')).toHaveLength(0);

    view.rerender(<HeapPanel heap={heapAt(storeStep + 1)} frame={frameAt(storeStep + 1)} />);

    expect(cellValues()).toEqual(['3', '3', '4', '1', '2']);
    const pulses = screen.getAllByTestId('heap-pulse');
    expect(pulses).toHaveLength(1);
    expect(pulses[0]?.closest('[data-testid="heap-cell"]')?.getAttribute('data-index')).toBe('0');
  });

  it('leaves the freshly allocated array unflashed', () => {
    const view = render(<HeapPanel heap={[]} />);

    view.rerender(<HeapPanel heap={heapAt(loadStep)} />);

    expect(screen.queryAllByTestId('heap-pulse')).toHaveLength(0);
  });

  it('shows the sorted array on the terminal snapshot', () => {
    render(<HeapPanel heap={heapAt(terminalStep())} />);

    expect(cellValues()).toEqual(['1', '2', '3', '4', '5']);
    expect(currentCell()).toBeUndefined();
    expect(screen.getByText('length 5')).toBeInTheDocument();
  });

  it('is not rendered at all for a run that allocates nothing', () => {
    render(<HeapPanel heap={[]} frame={frameAt(loadStep)} mnemonic="iaload" />);

    expect(screen.queryByRole('region', { name: 'Heap' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('heap-array')).not.toBeInTheDocument();
  });

  it('marks nothing when the instruction touches no array', () => {
    render(<HeapPanel heap={heapAt(loadStep)} frame={frameAt(loadStep)} mnemonic="iadd" />);

    expect(currentCell()).toBeUndefined();
    expect(screen.getByText('length 5')).toBeInTheDocument();
  });
});
