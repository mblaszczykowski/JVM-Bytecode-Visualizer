import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TimelineEvent } from '../../services/timeline';

import { depths } from '../__fixtures__/factorial-run';
import { DepthTrack } from './DepthTrack';

const LABEL = 'Execution history position';

const runDepths = depths();

function accentBars(): number {
  return screen.getAllByTestId('depth-bar').filter((bar) => bar.dataset.frame === 'true').length;
}

describe('DepthTrack', () => {
  it('exposes the scrubber as a slider over the whole history', () => {
    render(<DepthTrack depths={runDepths} stepIndex={7} onSeek={vi.fn()} label={LABEL} />);

    const slider = screen.getByRole('slider', { name: LABEL });

    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', String(runDepths.length - 1));
    expect(slider).toHaveAttribute('aria-valuetext', `step 8 of ${String(runDepths.length)}`);
  });

  it('reports the step the user seeks to', () => {
    const onSeek = vi.fn();
    render(<DepthTrack depths={runDepths} stepIndex={0} onSeek={onSeek} label={LABEL} />);

    fireEvent.change(screen.getByRole('slider', { name: LABEL }), { target: { value: '12' } });

    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it('draws one bar per step for a short history', () => {
    render(<DepthTrack depths={runDepths} stepIndex={0} onSeek={vi.fn()} label={LABEL} />);

    expect(screen.getAllByTestId('depth-bar')).toHaveLength(runDepths.length);
  });

  it('buckets a long history down to a readable number of bars', () => {
    const long = Array.from({ length: 5000 }, (_, step) => (step % 7) + 1);
    render(<DepthTrack depths={long} stepIndex={0} onSeek={vi.fn()} label={LABEL} />);

    expect(screen.getAllByTestId('depth-bar')).toHaveLength(220);
  });

  it('keeps a run of equally deep steps together as one frame', () => {
    const depths = [1, 2, 2, 1, 2, 1];
    const { rerender } = render(
      <DepthTrack depths={depths} stepIndex={1} onSeek={vi.fn()} label={LABEL} />,
    );

    expect(accentBars()).toBe(2);

    rerender(<DepthTrack depths={depths} stepIndex={4} onSeek={vi.fn()} label={LABEL} />);

    expect(accentBars()).toBe(1);
  });

  it('leaves the marker lane out when the run has no events', () => {
    render(<DepthTrack depths={runDepths} stepIndex={0} onSeek={vi.fn()} label={LABEL} />);

    expect(screen.queryAllByTestId('timeline-mark')).toHaveLength(0);
  });

  it('marks each event over the bar covering its step', () => {
    const events: readonly TimelineEvent[] = [
      { step: 1, kind: 'call' },
      { step: 12, kind: 'heap-write' },
      { step: 30, kind: 'return' },
    ];
    render(
      <DepthTrack
        depths={runDepths}
        events={events}
        stepIndex={0}
        onSeek={vi.fn()}
        label={LABEL}
      />,
    );

    expect(screen.getAllByTestId('timeline-mark').map((mark) => mark.dataset.kind)).toEqual([
      'call',
      'heap-write',
      'return',
    ]);
  });

  it('collapses events down to the resolution of the track', () => {
    const long = Array.from({ length: 5000 }, () => 1);
    const events: readonly TimelineEvent[] = long.map((_, step) => ({ step, kind: 'branch' }));
    render(
      <DepthTrack depths={long} events={events} stepIndex={0} onSeek={vi.fn()} label={LABEL} />,
    );

    expect(screen.getAllByTestId('timeline-mark')).toHaveLength(220);
  });

  it('names the event at the current step on the slider', () => {
    const events: readonly TimelineEvent[] = [{ step: 7, kind: 'print' }];
    const { rerender } = render(
      <DepthTrack
        depths={runDepths}
        events={events}
        stepIndex={7}
        onSeek={vi.fn()}
        label={LABEL}
      />,
    );

    expect(screen.getByRole('slider', { name: LABEL })).toHaveAttribute(
      'aria-valuetext',
      `step 8 of ${String(runDepths.length)}, console output`,
    );

    rerender(
      <DepthTrack
        depths={runDepths}
        events={events}
        stepIndex={8}
        onSeek={vi.fn()}
        label={LABEL}
      />,
    );

    expect(screen.getByRole('slider', { name: LABEL })).toHaveAttribute(
      'aria-valuetext',
      `step 9 of ${String(runDepths.length)}`,
    );
  });

  it('highlights the steps the current frame is alive for', () => {
    const { rerender } = render(
      <DepthTrack depths={runDepths} stepIndex={28} onSeek={vi.fn()} label={LABEL} />,
    );

    expect(accentBars()).toBe(5);

    rerender(
      <DepthTrack
        depths={runDepths}
        stepIndex={runDepths.length - 1}
        onSeek={vi.fn()}
        label={LABEL}
      />,
    );

    expect(accentBars()).toBe(0);
  });
});
