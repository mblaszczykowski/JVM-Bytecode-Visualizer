import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { mockSourceFileName, mockSourceLines } from './__fixtures__/mock-history';
import { SourcePanel } from './SourcePanel';

function sourceLineAt(index: number): HTMLElement {
  const row = screen.getAllByTestId('source-line')[index];
  if (row === undefined) {
    throw new Error(`No source line rendered at index ${String(index)}`);
  }
  return row;
}

describe('SourcePanel', () => {
  it('renders every line with its number', () => {
    render(
      <SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={undefined} />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(mockSourceLines.length);
    expect(screen.getByRole('region', { name: 'Source' })).toBeInTheDocument();
    expect(screen.getByText(mockSourceFileName)).toBeInTheDocument();
  });

  it('highlights the line named by the current snapshot', () => {
    render(<SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={6} />);

    const current = screen.getByTestId('current-source-line');

    expect(current).toHaveTextContent('return n * factorial(n - 1);');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByTestId('current-source-line')).toHaveLength(1);
  });

  it('colours keywords, method names and literals of an inactive line', () => {
    render(
      <SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={undefined} />,
    );

    const line = within(sourceLineAt(5));

    expect(line.getByText('return')).toHaveClass('text-syntax-keyword');
    expect(line.getByText('factorial')).toHaveClass('text-syntax-method');
    expect(line.getByText('1')).toHaveClass('text-syntax-number');
  });

  it('explains the pc range and the line mapping rule in the footer', () => {
    render(
      <SourcePanel
        fileName={mockSourceFileName}
        lines={mockSourceLines}
        currentLine={6}
        pcRange={{ from: 7, to: 15 }}
        lineMappingNote="LineNumberTable · largest startPc ≤ 11 → line 6"
      />,
    );

    expect(screen.getByText('pc 7–15')).toBeInTheDocument();
    expect(screen.getByText('LineNumberTable · largest startPc ≤ 11 → line 6')).toBeInTheDocument();
  });

  it('highlights nothing when the snapshot has no line mapping', () => {
    render(
      <SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={undefined} />,
    );

    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
  });

  it('ignores a line number outside the file', () => {
    render(<SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={999} />);

    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
  });

  it('seeks to the first step a line was reached on, and keeps one tab stop', () => {
    const onSeek = vi.fn();
    render(
      <SourcePanel
        fileName={mockSourceFileName}
        lines={mockSourceLines}
        currentLine={6}
        stepForLine={
          new Map([
            [3, 2],
            [6, 5],
          ])
        }
        onSeek={onSeek}
      />,
    );

    // Only lines the run actually reached are seekable.
    const targets = screen.getAllByRole('button');
    expect(targets.map((target) => target.getAttribute('aria-label'))).toEqual([
      'Go to line 3',
      'Go to line 6',
    ]);
    // The current line holds the tab stop; the arrow keys reach the rest.
    expect(targets.map((target) => target.getAttribute('tabindex'))).toEqual(['-1', '0']);

    fireEvent.click(screen.getByRole('button', { name: 'Go to line 3' }));
    expect(onSeek).toHaveBeenCalledWith(2);
  });

  it('moves the focus between rows with the arrow keys', () => {
    render(
      <SourcePanel
        fileName={mockSourceFileName}
        lines={mockSourceLines}
        currentLine={3}
        stepForLine={
          new Map([
            [3, 2],
            [4, 3],
          ])
        }
        onSeek={vi.fn()}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Go to line 3' }), { key: 'ArrowDown' });

    expect(screen.getByRole('button', { name: 'Go to line 4' })).toHaveFocus();
  });
});
