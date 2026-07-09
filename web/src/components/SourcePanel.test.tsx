import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockSourceFileName, mockSourceLines } from './__fixtures__/mock-history';
import { SourcePanel } from './SourcePanel';

describe('SourcePanel', () => {
  it('renderuje wszystkie linie z numeracją', () => {
    render(
      <SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={undefined} />,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(mockSourceLines.length);
    expect(screen.getByRole('region', { name: 'Źródło' })).toBeInTheDocument();
    expect(screen.getByText(mockSourceFileName)).toBeInTheDocument();
    expect(screen.getByText('static int factorial(int n) {')).toBeInTheDocument();
  });

  it('podświetla linię wskazaną przez sourceLine bieżącego snapshotu', () => {
    render(<SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={6} />);

    const current = screen.getByTestId('current-source-line');

    expect(current).toHaveTextContent('return n * factorial(n - 1);');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByTestId('current-source-line')).toHaveLength(1);
  });

  it('nie podświetla niczego, gdy snapshot nie ma mapowania na linię', () => {
    render(
      <SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={undefined} />,
    );

    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
  });

  it('ignoruje numer linii spoza zakresu pliku', () => {
    render(<SourcePanel fileName={mockSourceFileName} lines={mockSourceLines} currentLine={999} />);

    expect(screen.queryByTestId('current-source-line')).not.toBeInTheDocument();
  });
});
