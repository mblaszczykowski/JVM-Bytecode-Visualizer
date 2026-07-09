import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockSnapshotAt } from './__fixtures__/mock-history';
import { CallStackPanel } from './CallStackPanel';

/** Krok 10 mocka: main → factorial(2) → factorial(1), czyli maksymalna głębokość. */
const deepestFrames = mockSnapshotAt(10).callStack;

function frameAt(position: number): HTMLElement {
  const frame = screen.getAllByTestId('call-frame')[position];
  if (frame === undefined) {
    throw new Error(`Brak wyrenderowanej ramki na pozycji ${String(position)}`);
  }
  return frame;
}

describe('CallStackPanel', () => {
  it('renderuje ramki od najnowszej u góry', () => {
    render(<CallStackPanel frames={deepestFrames} />);

    const rendered = screen.getAllByTestId('call-frame');

    expect(rendered).toHaveLength(3);
    expect(rendered.map((frame) => frame.getAttribute('data-frame-index'))).toEqual([
      '2',
      '1',
      '0',
    ]);
    expect(frameAt(0)).toHaveAttribute('aria-current', 'true');
    expect(frameAt(2)).not.toHaveAttribute('aria-current');
  });

  it('pokazuje nazwę metody, deskryptor i pc ramki', () => {
    render(<CallStackPanel frames={deepestFrames} />);

    const oldest = within(frameAt(2));

    expect(oldest.getByText('main')).toBeInTheDocument();
    expect(oldest.getByText('([Ljava/lang/String;)V')).toBeInTheDocument();
    expect(oldest.getByText('pc 4')).toBeInTheDocument();
  });

  it('przygasza starsze ramki gradacyjnie według pozycji w tablicy', () => {
    render(<CallStackPanel frames={deepestFrames} />);

    expect(frameAt(0)).toHaveStyle({ opacity: '1' });
    expect(frameAt(1)).toHaveStyle({ opacity: '0.72' });
    expect(frameAt(2)).toHaveStyle({ opacity: '0.54' });
  });

  it('pokazuje czytelny stan pusty dla snapshotu terminalnego', () => {
    render(<CallStackPanel frames={[]} />);

    expect(screen.queryByTestId('call-frame')).not.toBeInTheDocument();
    expect(screen.getByText(/Brak aktywnej ramki/)).toBeInTheDocument();
    expect(screen.getByText('głębokość 0')).toBeInTheDocument();
  });
});
