import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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

/** Panel headings in the order the column stacks them. */
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

    // The completion card carries the heap here, so it is not repeated as a fourth section.
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

  it('renders no console output for a snapshot whose interpreter records none', () => {
    const snapshot = factorialSnapshotAt(20);
    render(<StateColumn frames={snapshot.callStack} consoleLines={consoleLinesOf(snapshot)} />);

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals', 'Console']);
    expect(screen.queryByTestId('console-line')).not.toBeInTheDocument();
  });
});
