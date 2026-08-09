import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { consoleLinesOf } from '../services/program';

import {
  firstStepOf,
  heapAt,
  mnemonicAt,
  snapshotAt,
  terminalStep,
  runSummary,
} from './__fixtures__/bubble-sort-run';
import { snapshotAt as factorialSnapshotAt } from './__fixtures__/factorial-run';
import { StateColumn } from './StateColumn';

const sortingStep = firstStepOf('iaload');

function sections(): string[] {
  return screen
    .getAllByRole('region')
    .map((region) => region.getAttribute('aria-label') ?? '')
    .filter((label) => label !== '');
}

describe('StateColumn', () => {
  it('adds the heap under the locals for a program that allocates', () => {
    render(
      <StateColumn
        frames={snapshotAt(sortingStep).callStack}
        heap={heapAt(sortingStep)}
        mnemonic={mnemonicAt(sortingStep)}
      />,
    );

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals', 'Heap']);
    expect(screen.getAllByTestId('heap-cell')).toHaveLength(5);
  });

  it('leaves the int-only runs exactly as they were', () => {
    render(<StateColumn frames={factorialSnapshotAt(20).callStack} />);

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals']);
    expect(screen.queryByTestId('heap-array')).not.toBeInTheDocument();
  });

  it('ends the run on the result and the array the sort left sorted', () => {
    const step = terminalStep();
    render(
      <StateColumn
        frames={snapshotAt(step).callStack}
        heap={heapAt(step)}
        lastLiveFrames={snapshotAt(step - 1).callStack}
        summary={runSummary()}
      />,
    );

    expect(sections()).toEqual(['Result', 'Locals']);
    const card = screen.getByTestId('completion-card');
    expect(card).toContainElement(screen.getByTestId('heap-array'));
    expect(screen.getAllByTestId('heap-cell').map((cell) => cell.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
  });

  it('fills its cell without stretching the sections over it', () => {
    render(<StateColumn frames={factorialSnapshotAt(20).callStack} />);

    const column = screen.getByTestId('state-column');
    expect(column.className).not.toContain('self-start');
    expect(column.className).toContain('max-h-full');
    expect(column.className).toContain('min-h-0');
  });

  it('leaves the console out of a run that printed nothing', () => {
    render(<StateColumn frames={factorialSnapshotAt(20).callStack} />);

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals']);
    expect(screen.queryByTestId('console-panel')).not.toBeInTheDocument();
  });

  it('adds the console last for a run that printed', () => {
    render(
      <StateColumn
        frames={snapshotAt(sortingStep).callStack}
        heap={heapAt(sortingStep)}
        mnemonic={mnemonicAt(sortingStep)}
        consoleLines={['before: 5 3 4 1 2']}
      />,
    );

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals', 'Heap', 'Console']);
    expect(screen.getAllByTestId('console-line').map((row) => row.textContent)).toEqual([
      'before: 5 3 4 1 2',
    ]);
  });

  it('keeps the console on the steps before the first line is printed', () => {
    render(<StateColumn frames={factorialSnapshotAt(20).callStack} consoleLines={[]} />);

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals', 'Console']);
    expect(screen.getByText('nothing printed yet')).toBeInTheDocument();
  });

  it('keeps what the program printed on the completed branch', () => {
    const step = terminalStep();
    render(
      <StateColumn
        frames={snapshotAt(step).callStack}
        heap={heapAt(step)}
        lastLiveFrames={snapshotAt(step - 1).callStack}
        summary={runSummary()}
        consoleLines={['after: 1 2 3 4 5']}
      />,
    );

    expect(sections()).toEqual(['Result', 'Locals', 'Console']);
    expect(screen.getByTestId('console-line').textContent).toBe('after: 1 2 3 4 5');
  });

  it('lets both the stack and the locals be followed back to where a value came from', () => {
    const onSeekToStep = vi.fn();
    render(
      <StateColumn
        frames={snapshotAt(sortingStep).callStack}
        heap={heapAt(sortingStep)}
        onSeekToStep={onSeekToStep}
      />,
    );

    const stack = screen.getByRole('region', { name: 'Operand stack' });
    const locals = screen.getByRole('region', { name: 'Locals' });
    expect(within(stack).getAllByTestId('operand-origin').length).toBeGreaterThan(0);

    fireEvent.click(within(locals).getByRole('button', { name: /where a was set to int\[5\]@0/ }));

    expect(onSeekToStep).toHaveBeenCalledWith(23);
  });

  it('keeps the trail on the locals the finished run left behind', () => {
    const step = terminalStep();
    const onSeekToStep = vi.fn();
    render(
      <StateColumn
        frames={snapshotAt(step).callStack}
        heap={heapAt(step)}
        lastLiveFrames={snapshotAt(step - 1).callStack}
        summary={runSummary()}
        onSeekToStep={onSeekToStep}
      />,
    );

    fireEvent.click(screen.getByTestId('local-origin'));

    expect(onSeekToStep).toHaveBeenCalledTimes(1);
  });

  it('offers no trail where the column was given no way to seek', () => {
    render(<StateColumn frames={snapshotAt(sortingStep).callStack} heap={heapAt(sortingStep)} />);

    expect(screen.queryByTestId('operand-origin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('local-origin')).not.toBeInTheDocument();
  });

  it('renders no console output for a snapshot whose interpreter records none', () => {
    const snapshot = factorialSnapshotAt(20);
    render(<StateColumn frames={snapshot.callStack} consoleLines={consoleLinesOf(snapshot)} />);

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals', 'Console']);
    expect(screen.queryByTestId('console-line')).not.toBeInTheDocument();
  });
});
