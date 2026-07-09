import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('TransportControls', () => {
  it('pokazuje wskaźnik "krok X / N" liczony od jedynki', () => {
    render(
      <TransportControls
        stepIndex={3}
        stepCount={20}
        isPlaying={false}
        speed={1}
        {...handlers()}
      />,
    );

    expect(screen.getByTestId('step-counter')).toHaveTextContent('krok 4 / 20');
  });

  it('wywołuje callbacki kroków po kliknięciu przycisków', () => {
    const spies = handlers();
    render(
      <TransportControls stepIndex={5} stepCount={20} isPlaying={false} speed={1} {...spies} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Krok naprzód' }));
    fireEvent.click(screen.getByRole('button', { name: 'Krok wstecz' }));

    expect(spies.onStepForward).toHaveBeenCalledTimes(1);
    expect(spies.onStepBack).toHaveBeenCalledTimes(1);
  });

  it('przełącza odtwarzanie i opisuje bieżący stan w aria-label', () => {
    const spies = handlers();
    const { rerender } = render(
      <TransportControls stepIndex={0} stepCount={20} isPlaying={false} speed={1} {...spies} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Odtwórz' }));
    expect(spies.onTogglePlay).toHaveBeenCalledTimes(1);

    rerender(
      <TransportControls stepIndex={0} stepCount={20} isPlaying={true} speed={1} {...spies} />,
    );
    expect(screen.getByRole('button', { name: 'Wstrzymaj' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('blokuje kroki na krańcach historii', () => {
    const spies = handlers();
    const { rerender } = render(
      <TransportControls stepIndex={0} stepCount={20} isPlaying={false} speed={1} {...spies} />,
    );

    expect(screen.getByRole('button', { name: 'Krok wstecz' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Krok naprzód' })).toBeEnabled();

    rerender(
      <TransportControls stepIndex={19} stepCount={20} isPlaying={false} speed={1} {...spies} />,
    );

    expect(screen.getByRole('button', { name: 'Krok wstecz' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Krok naprzód' })).toBeDisabled();
  });

  it('udostępnia scrubber jako suwak z pełnym opisem zakresu', () => {
    const spies = handlers();
    render(
      <TransportControls stepIndex={7} stepCount={20} isPlaying={false} speed={1} {...spies} />,
    );

    const scrubber = screen.getByRole('slider', { name: 'Pozycja w historii wykonania' });

    expect(scrubber).toHaveAttribute('min', '0');
    expect(scrubber).toHaveAttribute('max', '19');
    expect(scrubber).toHaveAttribute('aria-valuetext', 'krok 8 z 20');

    fireEvent.change(scrubber, { target: { value: '12' } });
    expect(spies.onSeek).toHaveBeenCalledWith(12);
  });

  it('zgłasza zmianę prędkości jako liczbę', () => {
    const spies = handlers();
    render(
      <TransportControls stepIndex={0} stepCount={20} isPlaying={false} speed={1} {...spies} />,
    );

    const speedSelect = screen.getByLabelText('Prędkość');

    expect(screen.getByRole('option', { name: '0.5×' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '8×' })).toBeInTheDocument();

    fireEvent.change(speedSelect, { target: { value: '4' } });
    expect(spies.onSpeedChange).toHaveBeenCalledWith(4);
  });
});
