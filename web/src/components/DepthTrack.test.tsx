import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { mockDepths } from './__fixtures__/mock-derivations';
import { DepthTrack } from './DepthTrack';

const LABEL = 'Execution history position';

/** Bars of the frame that is on top at the given step are drawn in the accent colour. */
function accentBars(): number {
  return screen
    .getAllByTestId('depth-bar')
    .filter((bar) => bar.className.includes('rgb(108_178_255/0.65)')).length;
}

describe('DepthTrack', () => {
  it('exposes the scrubber as a slider over the whole history', () => {
    render(<DepthTrack depths={mockDepths} stepIndex={7} onSeek={vi.fn()} label={LABEL} />);

    const slider = screen.getByRole('slider', { name: LABEL });

    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', String(mockDepths.length - 1));
    expect(slider).toHaveAttribute('aria-valuetext', `step 8 of ${String(mockDepths.length)}`);
  });

  it('reports the step the user seeks to', () => {
    const onSeek = vi.fn();
    render(<DepthTrack depths={mockDepths} stepIndex={0} onSeek={onSeek} label={LABEL} />);

    fireEvent.change(screen.getByRole('slider', { name: LABEL }), { target: { value: '12' } });

    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it('draws one bar per step for a short history', () => {
    render(<DepthTrack depths={mockDepths} stepIndex={0} onSeek={vi.fn()} label={LABEL} />);

    expect(screen.getAllByTestId('depth-bar')).toHaveLength(mockDepths.length);
  });

  it('buckets a long history down to a readable number of bars', () => {
    const long = Array.from({ length: 5000 }, (_, step) => (step % 7) + 1);
    render(<DepthTrack depths={long} stepIndex={0} onSeek={vi.fn()} label={LABEL} />);

    expect(screen.getAllByTestId('depth-bar')).toHaveLength(120);
  });

  it('keeps a run of equally deep steps together as one frame', () => {
    // Two separate calls at depth 2, with a return to the caller between them.
    const depths = [1, 2, 2, 1, 2, 1];
    const { rerender } = render(
      <DepthTrack depths={depths} stepIndex={1} onSeek={vi.fn()} label={LABEL} />,
    );

    expect(accentBars()).toBe(2);

    rerender(<DepthTrack depths={depths} stepIndex={4} onSeek={vi.fn()} label={LABEL} />);

    expect(accentBars()).toBe(1);
  });

  it('highlights the steps the current frame is alive for', () => {
    // Steps 10–14 are the only ones with three frames, i.e. the lifetime of factorial(1).
    const { rerender } = render(
      <DepthTrack depths={mockDepths} stepIndex={12} onSeek={vi.fn()} label={LABEL} />,
    );

    expect(accentBars()).toBe(5);

    rerender(<DepthTrack depths={mockDepths} stepIndex={19} onSeek={vi.fn()} label={LABEL} />);

    // The terminal snapshot has no frame at all, so nothing is highlighted.
    expect(accentBars()).toBe(0);
  });
});
