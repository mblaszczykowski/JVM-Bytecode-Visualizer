import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { consoleLinesOf } from '../services/program';

import { snapshotAt } from './__fixtures__/factorial-run';
import { ConsolePanel } from './ConsolePanel';

function rows(): HTMLElement[] {
  return screen.getAllByTestId('console-line');
}

function texts(): string[] {
  return rows().map((row) => row.textContent);
}

function currentRow(): HTMLElement | undefined {
  return rows().find((row) => row.dataset.current === 'true');
}

describe('ConsolePanel', () => {
  it('renders the printed lines in the order the program printed them', () => {
    render(<ConsolePanel lines={['fib(0) = 0', 'fib(1) = 1', 'fib(2) = 1']} />);

    expect(screen.getByRole('region', { name: 'Console' })).toBeInTheDocument();
    expect(texts()).toEqual(['fib(0) = 0', 'fib(1) = 1', 'fib(2) = 1']);
    expect(screen.getByText('3 lines')).toBeInTheDocument();
  });

  it('marks the newest line as the current one', () => {
    render(<ConsolePanel lines={['first', 'second', 'third']} />);

    expect(currentRow()?.textContent).toBe('third');
    expect(currentRow()?.getAttribute('aria-current')).toBe('true');
    expect(rows().filter((row) => row.dataset.current === 'true')).toHaveLength(1);
  });

  it('moves the accent onto each new line as the run prints', () => {
    const view = render(<ConsolePanel lines={['first']} />);
    expect(currentRow()?.textContent).toBe('first');

    view.rerender(<ConsolePanel lines={['first', 'second']} />);

    expect(currentRow()?.textContent).toBe('second');
    expect(rows()[0]?.dataset.current).toBeUndefined();
  });

  it('says so in a row rather than standing empty before anything is printed', () => {
    render(<ConsolePanel lines={[]} />);

    expect(screen.getByRole('region', { name: 'Console' })).toBeInTheDocument();
    expect(screen.queryByTestId('console-line')).not.toBeInTheDocument();
    expect(screen.getByText('nothing printed yet')).toBeInTheDocument();
    expect(screen.getByText('0 lines')).toBeInTheDocument();
  });

  it('keeps the whitespace a program printed, including a line that is only whitespace', () => {
    render(<ConsolePanel lines={['  indented', '   ', '']} />);

    expect(texts()).toEqual(['  indented', '   ', '']);
    for (const row of rows()) {
      expect(row.className).toContain('whitespace-pre');
    }
  });

  it('renders one line as one row, so a long line never becomes two', () => {
    render(<ConsolePanel lines={['x'.repeat(400)]} />);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.className).toContain('h-[26px]');
  });

  it('renders nothing at all for a snapshot that recorded no output', () => {
    const { unmount } = render(<ConsolePanel lines={consoleLinesOf({ step: 0, callStack: [] })} />);
    expect(screen.queryByTestId('console-line')).not.toBeInTheDocument();
    unmount();

    render(<ConsolePanel lines={consoleLinesOf(snapshotAt(10))} />);

    expect(screen.queryByTestId('console-line')).not.toBeInTheDocument();
    expect(screen.getByText('nothing printed yet')).toBeInTheDocument();
  });
});
