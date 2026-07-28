import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
