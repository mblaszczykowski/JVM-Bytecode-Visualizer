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
import {
  externalsAt as collatzExternalsAt,
  firstInternedStep as collatzInternedStep,
  snapshotAt as collatzSnapshotAt,
} from './__fixtures__/collatz-run';
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

  it('says what the step did to the top frame, for a reader who cannot see it', () => {
    const { rerender } = render(<StateColumn frames={factorialSnapshotAt(20).callStack} />);

    const announcement = screen.getByTestId('state-announcement');
    expect(announcement).toHaveAttribute('aria-live', 'polite');
    expect(announcement).toHaveTextContent(
      'In factorial; n is now 2; operand stack 2 deep, top 1.',
    );

    rerender(<StateColumn frames={factorialSnapshotAt(21).callStack} />);

    expect(screen.getByTestId('state-announcement')).toHaveTextContent('operand stack empty.');
  });

  it('names the locals by the value they hold, references included', () => {
    render(<StateColumn frames={snapshotAt(sortingStep).callStack} heap={heapAt(sortingStep)} />);

    expect(screen.getByTestId('state-announcement')).toHaveTextContent(
      'In sortedMinimum; a is now int[5]@0; i is now 0; j is now 0; operand stack 2 deep, top 0.',
    );
  });

  it('names an interned object in the announcement rather than its handle', () => {
    const step = collatzInternedStep();
    render(
      <StateColumn
        frames={collatzSnapshotAt(step).callStack}
        externals={collatzExternalsAt(step)}
      />,
    );

    expect(screen.getByTestId('state-announcement')).toHaveTextContent(
      'operand stack 1 deep, top System.out.',
    );
  });

  it('reads what the run printed, once, on the step that printed it', () => {
    const frames = factorialSnapshotAt(20).callStack;
    const { rerender } = render(<StateColumn frames={frames} consoleLines={[]} />);

    rerender(<StateColumn frames={factorialSnapshotAt(21).callStack} consoleLines={['24']} />);
    expect(screen.getByTestId('state-announcement')).toHaveTextContent('printed 24');

    rerender(<StateColumn frames={factorialSnapshotAt(22).callStack} consoleLines={['24']} />);
    expect(screen.getByTestId('state-announcement')).not.toHaveTextContent('printed 24');
  });

  it('holds the announcement back while the run is playing itself', () => {
    render(<StateColumn frames={factorialSnapshotAt(20).callStack} isPlaying />);

    expect(screen.getByTestId('state-announcement')).toHaveAttribute('aria-live', 'off');
  });

  it('says nothing about state for a class file that was never run', () => {
    render(<StateColumn frames={[]} noRunNote="Nothing was executed." />);

    expect(screen.queryByTestId('state-announcement')).not.toBeInTheDocument();
  });

  it('renders no console output for a snapshot whose interpreter records none', () => {
    const snapshot = factorialSnapshotAt(20);
    render(<StateColumn frames={snapshot.callStack} consoleLines={consoleLinesOf(snapshot)} />);

    expect(sections()).toEqual(['Call stack', 'Operand stack', 'Locals', 'Console']);
    expect(screen.queryByTestId('console-line')).not.toBeInTheDocument();
  });
});
