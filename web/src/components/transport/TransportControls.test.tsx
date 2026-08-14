import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PLAYBACK_SPEEDS } from '../../hooks/useExecutionPlayer';

import { depths } from '../__fixtures__/factorial-run';
import { TransportControls } from './TransportControls';

const runDepths = depths();

function handlers() {
  return {
    events: [],
    canStepOver: true,
    canStepOut: true,
    onSeek: vi.fn(),
    onTogglePlay: vi.fn(),
    onStepForward: vi.fn(),
    onStepBack: vi.fn(),
    onStepOver: vi.fn(),
    onStepOut: vi.fn(),
    onSpeedChange: vi.fn(),
  };
}

function flatDepths(steps: number): readonly number[] {
  return Array.from({ length: steps }, () => 1);
}

describe('TransportControls', () => {
  it('shows a one-based "step X / N" indicator', () => {
    render(
      <TransportControls
        stepIndex={3}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...handlers()}
      />,
    );

    expect(screen.getByTestId('step-counter')).toHaveTextContent('step 4 / 20');
  });

  it('calls the step callbacks when the buttons are clicked', () => {
    const spies = handlers();
    render(
      <TransportControls
        stepIndex={5}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Step forward' }));
    fireEvent.click(screen.getByRole('button', { name: 'Step back' }));

    expect(spies.onStepForward).toHaveBeenCalledTimes(1);
    expect(spies.onStepBack).toHaveBeenCalledTimes(1);
  });

  it('toggles playback and names the current state in the label', () => {
    const spies = handlers();
    const { rerender } = render(
      <TransportControls
        stepIndex={0}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(spies.onTogglePlay).toHaveBeenCalledTimes(1);

    rerender(
      <TransportControls
        stepIndex={0}
        stepCount={20}
        isPlaying={true}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports the end of the history without leaving the tab order', () => {
    const spies = handlers();
    const { rerender } = render(
      <TransportControls
        stepIndex={0}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    expect(screen.getByRole('button', { name: 'Step back' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Step forward' })).not.toHaveAttribute(
      'aria-disabled',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Step back' }));
    expect(spies.onStepBack).not.toHaveBeenCalled();

    rerender(
      <TransportControls
        stepIndex={19}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    expect(screen.getByRole('button', { name: 'Step back' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Step forward' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('names the shortcut of each stepping button and calls it', () => {
    const spies = handlers();
    render(
      <TransportControls
        stepIndex={5}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    const stepOver = screen.getByRole('button', { name: 'Step over' });
    const stepOut = screen.getByRole('button', { name: 'Step out' });

    expect(stepOver).toHaveAttribute('title', 'Step over (↓)');
    expect(stepOut).toHaveAttribute('title', 'Step out (↑)');

    fireEvent.click(stepOver);
    fireEvent.click(stepOut);

    expect(spies.onStepOver).toHaveBeenCalledTimes(1);
    expect(spies.onStepOut).toHaveBeenCalledTimes(1);
  });

  it('disables a stepping button the history has no target for', () => {
    const spies = handlers();
    render(
      <TransportControls
        stepIndex={5}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
        canStepOver={false}
        canStepOut={false}
      />,
    );

    const stepOut = screen.getByRole('button', { name: 'Step out' });

    expect(screen.getByRole('button', { name: 'Step over' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(stepOut).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(stepOut);
    expect(spies.onStepOut).not.toHaveBeenCalled();
  });

  it('marks the run on the scrubber from the events it is handed', () => {
    render(
      <TransportControls
        stepIndex={0}
        stepCount={runDepths.length}
        isPlaying={false}
        speed={1}
        depths={runDepths}
        {...handlers()}
        events={[
          { step: 1, kind: 'call' },
          { step: 30, kind: 'return' },
        ]}
      />,
    );

    expect(screen.getAllByTestId('timeline-mark')).toHaveLength(2);
  });

  it('exposes the depth chart as the scrubber slider', () => {
    const spies = handlers();
    render(
      <TransportControls
        stepIndex={7}
        stepCount={runDepths.length}
        isPlaying={false}
        speed={1}
        depths={runDepths}
        {...spies}
      />,
    );

    const scrubber = screen.getByRole('slider', { name: 'Execution history position' });

    expect(scrubber).toHaveAttribute('min', '0');
    expect(scrubber).toHaveAttribute('max', String(runDepths.length - 1));
    expect(scrubber).toHaveAttribute('aria-valuetext', `step 8 of ${String(runDepths.length)}`);
    expect(screen.getAllByTestId('depth-bar')).toHaveLength(runDepths.length);

    fireEvent.change(scrubber, { target: { value: '12' } });
    expect(spies.onSeek).toHaveBeenCalledWith(12);
  });

  it('cycles the speed pill from 0.5× up to 8× and back', () => {
    const spies = handlers();
    const { rerender } = render(
      <TransportControls
        stepIndex={0}
        stepCount={20}
        isPlaying={false}
        speed={1}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    const speedPill = screen.getByRole('button', { name: 'Playback speed 1×' });
    expect(speedPill).toHaveTextContent('1×');
    expect(speedPill).toHaveAttribute(
      'title',
      `Playback speed: cycles through ${String(PLAYBACK_SPEEDS[0])}× to ${String(PLAYBACK_SPEEDS.at(-1))}×`,
    );

    fireEvent.click(speedPill);
    expect(spies.onSpeedChange).toHaveBeenCalledWith(2);

    rerender(
      <TransportControls
        stepIndex={0}
        stepCount={20}
        isPlaying={false}
        speed={8}
        depths={flatDepths(20)}
        {...spies}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Playback speed 8×' }));
    expect(spies.onSpeedChange).toHaveBeenLastCalledWith(0.5);
  });
});
