import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { mockDepths } from './__fixtures__/mock-derivations';
import { TransportControls } from './TransportControls';

function handlers() {
  return {
    onSeek: vi.fn(),
    onTogglePlay: vi.fn(),
    onStepForward: vi.fn(),
    onStepBack: vi.fn(),
    onSpeedChange: vi.fn(),
  };
}

/** A flat depth history of `steps` entries, so the transport can be tested on its own. */
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

  it('blocks stepping past either end of the history', () => {
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

    expect(screen.getByRole('button', { name: 'Step back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Step forward' })).toBeEnabled();

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

    expect(screen.getByRole('button', { name: 'Step back' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Step forward' })).toBeDisabled();
  });

  it('exposes the depth chart as the scrubber slider', () => {
    const spies = handlers();
    render(
      <TransportControls
        stepIndex={7}
        stepCount={mockDepths.length}
        isPlaying={false}
        speed={1}
        depths={mockDepths}
        {...spies}
      />,
    );

    const scrubber = screen.getByRole('slider', { name: 'Execution history position' });

    expect(scrubber).toHaveAttribute('min', '0');
    expect(scrubber).toHaveAttribute('max', '19');
    expect(scrubber).toHaveAttribute('aria-valuetext', 'step 8 of 20');
    expect(screen.getAllByTestId('depth-bar')).toHaveLength(mockDepths.length);

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

    const speedPill = screen.getByRole('button', { name: 'Playback speed' });
    expect(speedPill).toHaveTextContent('1×');

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

    fireEvent.click(screen.getByRole('button', { name: 'Playback speed' }));
    expect(spies.onSpeedChange).toHaveBeenLastCalledWith(0.5);
  });
});
