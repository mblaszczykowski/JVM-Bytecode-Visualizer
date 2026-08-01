import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { lineMappingNote, offsetsForLine } from '../services/program';

import {
  factorialListing,
  sourceFileName,
  sourceLines,
  stepForLine,
} from './__fixtures__/factorial-run';
import { SourcePanel } from './SourcePanel';

/** The `Factorial.java` that ships next to the class file, as the app reads it. */
const fileName = sourceFileName();
const lines = sourceLines();

/** `return n * factorial(n - 1);` — the recursive call, and the line the run spends most on. */
const RECURSION_LINE = 29;
const CONDITION_LINE = 26;

function sourceLineAt(index: number): HTMLElement {
  const row = screen.getAllByTestId('source-line')[index];
  if (row === undefined) {
    throw new Error(`No source line rendered at index ${String(index)}`);
  }
  return row;
}

describe('SourcePanel', () => {
  it('renders every line with its number', () => {
    render(<SourcePanel fileName={fileName} lines={lines} currentLine={undefined} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(lines.length);
    expect(screen.getByRole('region', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getByText('Factorial.java')).toBeInTheDocument();
  });

  it('highlights the line named by the current snapshot', () => {
    render(<SourcePanel fileName={fileName} lines={lines} currentLine={RECURSION_LINE} />);

    const current = screen.getByTestId('current-source-line');

    expect(current).toHaveTextContent('return n * factorial(n - 1);');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByTestId('current-source-line')).toHaveLength(1);
  });

  it('colours keywords, method names and literals of an inactive line', () => {
    render(<SourcePanel fileName={fileName} lines={lines} currentLine={undefined} />);

    const line = within(sourceLineAt(RECURSION_LINE - 1));

    expect(line.getByText('return')).toHaveClass('text-syntax-keyword');
    expect(line.getByText('factorial')).toHaveClass('text-syntax-method');
    expect(line.getByText('1')).toHaveClass('text-syntax-number');
  });

  it('explains the pc range and the line mapping rule in the footer', () => {
    const listing = factorialListing();
    render(
      <SourcePanel
        fileName={fileName}
        lines={lines}
        currentLine={RECURSION_LINE}
        pcRange={offsetsForLine(listing, RECURSION_LINE)}
        lineMappingNote={lineMappingNote(listing, 11)}
      />,
    );

    // The recursive call compiles to the instructions at pc 7 through 15.
    expect(screen.getByText('pc 7–15')).toBeInTheDocument();
    expect(
      screen.getByText('LineNumberTable · largest startPc ≤ 11 → line 29'),
    ).toBeInTheDocument();
  });

  it('highlights nothing when the snapshot has no line mapping', () => {
    render(<SourcePanel fileName={fileName} lines={lines} currentLine={undefined} />);

    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
  });

  it('ignores a line number outside the file', () => {
    render(<SourcePanel fileName={fileName} lines={lines} currentLine={999} />);

    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
  });

  it('seeks to the first step a line was reached on, and keeps one tab stop', () => {
    const onSeek = vi.fn();
    render(
      <SourcePanel
        fileName={fileName}
        lines={lines}
        currentLine={RECURSION_LINE}
        stepForLine={stepForLine()}
        onSeek={onSeek}
      />,
    );

    // Only lines the run actually reached are seekable — the javadoc above them is not.
    // Scoped to the listing: the panel header carries a button of its own.
    const targets = within(screen.getByRole('list')).getAllByRole('button');
    expect(targets.map((target) => target.getAttribute('aria-label'))).toEqual([
      'Go to line 26',
      'Go to line 27',
      'Go to line 29',
      'Go to line 37',
      'Go to line 38',
    ]);
    // The current line holds the tab stop; the arrow keys reach the rest.
    expect(targets.map((target) => target.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '0',
      '-1',
      '-1',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Go to line 26' }));
    // `if (n <= 1)` is the first thing factorial does, two steps into the run.
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it('moves the focus between rows with the arrow keys', () => {
    render(
      <SourcePanel
        fileName={fileName}
        lines={lines}
        currentLine={CONDITION_LINE}
        stepForLine={stepForLine()}
        onSeek={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Go to line 26' }), { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: 'Go to line 27' })).toHaveFocus();
  });
});
