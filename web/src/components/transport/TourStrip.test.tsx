import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ResolvedStop, Tour } from '../../services/views/tours';

import { TourStrip } from './TourStrip';

const TOUR: Tour = {
  id: 'recursion',
  exampleId: 'factorial',
  title: 'How recursion looks from underneath',
  stops: [],
};

const STOPS: readonly ResolvedStop[] = [
  { step: 1, title: 'One call', body: 'invokestatic pushes a new frame.' },
  { step: 9, title: 'The bottom', body: 'n reached 1, so this frame returns.' },
  { step: 30, title: 'On the way back', body: 'imul runs after the callee returned.' },
];

function renderStrip(overrides: Partial<Parameters<typeof TourStrip>[0]> = {}) {
  const props = {
    available: [TOUR],
    active: { tour: TOUR, stops: STOPS },
    stopIndex: 0,
    onStart: vi.fn(),
    onGoToStop: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
  render(<TourStrip {...props} />);
  return props;
}

describe('offering a tour', () => {
  it('names what is on offer before anything is walked', () => {
    const props = renderStrip({ active: undefined });

    fireEvent.click(screen.getByTestId('tour-start'));

    expect(screen.getByTestId('tour-offer')).toHaveTextContent(
      'How recursion looks from underneath',
    );
    expect(props.onStart).toHaveBeenCalledWith('recursion');
  });

  it('says nothing for an example with no tours', () => {
    renderStrip({ active: undefined, available: [] });

    expect(screen.queryByTestId('tour-offer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tour-strip')).not.toBeInTheDocument();
  });
});

describe('walking a tour', () => {
  it('shows the stop and where it sits in the sequence', () => {
    renderStrip({ stopIndex: 1 });

    const strip = screen.getByTestId('tour-strip');
    expect(strip).toHaveTextContent('The bottom');
    expect(strip).toHaveTextContent('n reached 1, so this frame returns.');
    expect(strip).toHaveTextContent('2 / 3');
  });

  it('names the tour for a screen reader', () => {
    renderStrip();

    expect(
      screen.getByRole('region', { name: 'Guided tour: How recursion looks from underneath' }),
    ).toBeInTheDocument();
  });

  it('names its controls with the words on them, so voice control can reach them', () => {
    renderStrip({ stopIndex: 1 });

    expect(screen.getByTestId('tour-previous')).toHaveAccessibleName(/^Back\b/);
    expect(screen.getByTestId('tour-next')).toHaveAccessibleName(/^Next\b/);
  });

  it('announces the whole stop, not only its prose', () => {
    renderStrip({ stopIndex: 1 });

    const live = screen.getByTestId('tour-strip').querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('The bottom');
    expect(live).toHaveTextContent('2 / 3');
    expect(live).toHaveTextContent('n reached 1, so this frame returns.');
  });

  it('moves forward and back by index', () => {
    const props = renderStrip({ stopIndex: 1 });

    fireEvent.click(screen.getByTestId('tour-next'));
    expect(props.onGoToStop).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByTestId('tour-previous'));
    expect(props.onGoToStop).toHaveBeenCalledWith(0);
  });

  it('cannot go back from the first stop', () => {
    renderStrip({ stopIndex: 0 });

    expect(screen.getByTestId('tour-previous')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('tour-next')).not.toHaveAttribute('aria-disabled');
  });

  it('cannot go past the last stop, and offers to finish instead', () => {
    renderStrip({ stopIndex: 2 });

    expect(screen.getByTestId('tour-next')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('tour-leave')).toHaveTextContent('Done');
  });

  it('reports a boundary without leaving the tab order', () => {
    const props = renderStrip({ stopIndex: 0 });
    const back = screen.getByTestId('tour-previous');

    expect(back).not.toHaveAttribute('disabled');
    back.focus();
    expect(back).toHaveFocus();

    fireEvent.click(back);
    expect(props.onGoToStop).not.toHaveBeenCalled();
  });

  it('leaves the tour without moving the run', () => {
    const props = renderStrip({ stopIndex: 1 });

    expect(screen.getByTestId('tour-leave')).toHaveTextContent('Leave the tour');
    fireEvent.click(screen.getByTestId('tour-leave'));

    expect(props.onLeave).toHaveBeenCalledTimes(1);
    expect(props.onGoToStop).not.toHaveBeenCalled();
  });

  it('renders nothing for a stop index past the end rather than throwing', () => {
    renderStrip({ stopIndex: 9 });

    expect(screen.queryByTestId('tour-strip')).not.toBeInTheDocument();
  });
});
