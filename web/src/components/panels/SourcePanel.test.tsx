import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { lineMappingNote, offsetsForLine } from '../../services/loading/program';

import {
  factorialListing,
  sourceFileName,
  sourceLines,
  stepForLine,
} from '../__fixtures__/factorial-run';
import { SourcePanel } from './SourcePanel';

const fileName = sourceFileName();
const lines = sourceLines();

const RECURSION_LINE = 20;
const CONDITION_LINE = 17;

function sourceLineAt(index: number): HTMLElement {
  const row = screen.getAllByTestId('source-line')[index];
  if (row === undefined) {
    throw new Error(`No source line rendered at index ${String(index)}`);
  }
  return row;
}

function lineRow(lineNumber: number): HTMLElement {
  const row = screen.getAllByTestId(/source-line/)[lineNumber - 1];
  if (row === undefined) {
    throw new Error(`No source line rendered for line ${String(lineNumber)}`);
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

    expect(screen.getByText('pc 7–15')).toBeInTheDocument();
    expect(
      screen.getByText('LineNumberTable · largest startPc ≤ 11 → line 20'),
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

    const targets = within(screen.getByRole('list')).getAllByRole('button');
    expect(targets.map((target) => target.getAttribute('aria-label'))).toEqual([
      'Go to line 17',
      'Go to line 18',
      'Go to line 20',
      'Go to line 28',
      'Go to line 29',
    ]);
    expect(targets.map((target) => target.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '0',
      '-1',
      '-1',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Go to line 17' }));
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it('reports the line under the pointer, and the one the keyboard reaches', () => {
    const onLinkedLineChange = vi.fn();
    render(
      <SourcePanel
        fileName={fileName}
        lines={lines}
        currentLine={undefined}
        stepForLine={stepForLine()}
        onSeek={vi.fn()}
        onLinkedLineChange={onLinkedLineChange}
      />,
    );

    fireEvent.mouseOver(lineRow(RECURSION_LINE));
    expect(onLinkedLineChange).toHaveBeenLastCalledWith(RECURSION_LINE);

    const target = screen.getByRole('button', { name: `Go to line ${String(CONDITION_LINE)}` });
    fireEvent.focus(target);
    expect(onLinkedLineChange).toHaveBeenLastCalledWith(CONDITION_LINE);

    fireEvent.blur(target);
    expect(onLinkedLineChange).toHaveBeenLastCalledWith(undefined);
  });

  it('marks the linked line without claiming it is the current step', () => {
    render(
      <SourcePanel
        fileName={fileName}
        lines={lines}
        currentLine={CONDITION_LINE}
        linkedLine={RECURSION_LINE}
      />,
    );

    expect(lineRow(RECURSION_LINE)).toHaveAttribute('data-linked', 'true');
    expect(screen.getByTestId('current-source-line')).not.toHaveAttribute('data-linked');
  });

  it('carries the full text of every line it may be cutting off', () => {
    render(<SourcePanel fileName={fileName} lines={lines} currentLine={undefined} />);

    expect(lineRow(RECURSION_LINE)).toHaveAttribute('title', 'return n * factorial(n - 1);');
    expect(lineRow(22)).not.toHaveAttribute('title');
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

    fireEvent.keyDown(screen.getByRole('button', { name: 'Go to line 17' }), { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: 'Go to line 18' })).toHaveFocus();
  });
});
