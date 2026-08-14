import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ExternalValue, HeapObject } from '../../core/interpreter';

import {
  arrayAt,
  firstStepOf,
  frameAt,
  heapAt,
  mnemonicAt,
  terminalStep,
} from '../__fixtures__/bubble-sort-run';
import { HeapPanel } from './HeapPanel';

const loadStep = firstStepOf('iaload');
const storeStep = firstStepOf('iastore', { after: 40 });

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
    expect(screen.getByText('reads index 0')).toBeInTheDocument();
  });

  it('marks the element the current instruction writes', () => {
    renderAt(storeStep);

    expect(currentCell()?.dataset.index).toBe('0');
    expect(screen.getByText('writes index 0')).toBeInTheDocument();
    expect(cellValues()).toEqual(['5', '3', '4', '1', '2']);
  });

  it('flashes the cell a store rewrote, once, on the step that changed it', () => {
    const view = render(
      <HeapPanel heap={heapAt(storeStep)} frame={frameAt(storeStep)} stepIndex={storeStep} />,
    );
    expect(screen.queryAllByTestId('heap-pulse')).toHaveLength(0);

    view.rerender(
      <HeapPanel
        heap={heapAt(storeStep + 1)}
        frame={frameAt(storeStep + 1)}
        stepIndex={storeStep + 1}
      />,
    );

    expect(cellValues()).toEqual(['3', '3', '4', '1', '2']);
    const pulses = screen.getAllByTestId('heap-pulse');
    expect(pulses).toHaveLength(1);
    expect(pulses[0]?.closest('[data-testid="heap-cell"]')?.getAttribute('data-index')).toBe('0');
  });

  it('stays still when the reader scrubs back over the store', () => {
    const view = render(
      <HeapPanel
        heap={heapAt(storeStep + 1)}
        frame={frameAt(storeStep + 1)}
        stepIndex={storeStep + 1}
      />,
    );

    view.rerender(
      <HeapPanel heap={heapAt(storeStep)} frame={frameAt(storeStep)} stepIndex={storeStep} />,
    );

    expect(cellValues()).toEqual(['5', '3', '4', '1', '2']);
    expect(screen.queryAllByTestId('heap-pulse')).toHaveLength(0);
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

  describe('a field that holds a reference', () => {
    const heap: readonly HeapObject[] = [
      { kind: 'int-array', length: 2, elements: [7, 8] },
      {
        kind: 'instance',
        className: 'Counter',
        fields: [
          { name: 'count', descriptor: 'I', value: 3, kind: 'int' },
          { name: 'samples', descriptor: '[I', value: 0, kind: 'ref' },
          { name: 'next', descriptor: 'LCounter;', value: 9, kind: 'ref' },
          { name: 'sink', descriptor: 'Ljava/io/PrintStream;', value: 0, kind: 'external' },
        ],
      },
    ];

    const externals: readonly ExternalValue[] = [
      { className: 'java/io/PrintStream', label: 'System.out' },
    ];

    function fieldNamed(name: string): HTMLElement {
      const field = screen.getAllByTestId('heap-field').find((row) => row.dataset.field === name);
      if (field === undefined) {
        throw new Error(`No heap field rendered for ${name}`);
      }
      return field;
    }

    it('names the object a field points at rather than printing its handle', () => {
      render(<HeapPanel heap={heap} externals={externals} />);

      expect(within(fieldNamed('count')).getByText('3')).toBeInTheDocument();
      expect(within(fieldNamed('samples')).getByText('int[2]@0')).toBeInTheDocument();
      expect(within(fieldNamed('next')).getByText('null')).toBeInTheDocument();
      expect(within(fieldNamed('sink')).getByText('System.out')).toBeInTheDocument();
    });
  });
});
