import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('announces a stopped run as an alert', () => {
    render(<ErrorBanner severity="error" message="ArithmeticException: / by zero (pc 14)" />);

    const banner = screen.getByTestId('error-banner');

    expect(banner).toHaveAttribute('data-severity', 'error');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('ArithmeticException: / by zero (pc 14)');
    expect(banner).toHaveTextContent('Error');
  });

  it('uses the softer variant for a run that only hit the step limit', () => {
    render(
      <ErrorBanner
        severity="warning"
        message="Stopped after 20 000 steps. The program probably does not terminate; showing the history up to this point."
      />,
    );

    const banner = screen.getByRole('status');

    expect(banner).toHaveAttribute('data-severity', 'warning');
    expect(banner).toHaveTextContent('Warning');
  });

  it('offers a recovery action when one is given', () => {
    const onAction = vi.fn();
    render(
      <ErrorBanner
        severity="warning"
        message="Stopped after 20 000 steps."
        action={{ label: 'Raise the limit', onAction }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Raise the limit' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('writes the severity as a word, not as spaced-out capitals', () => {
    render(<ErrorBanner severity="error" message="Something went wrong." />);

    const label = screen.getByText('Error');

    expect(label.className).not.toMatch(/uppercase|tracking-/);
  });

  it('can be closed when the caller offers a way back', () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner severity="error" message="Not a .class file." onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has no dismiss button when there is nothing to dismiss to', () => {
    render(<ErrorBanner severity="error" message="Not a .class file." />);

    expect(screen.queryByRole('button', { name: 'Dismiss this message' })).not.toBeInTheDocument();
  });

  it('renders the informational variant', () => {
    render(<ErrorBanner severity="info" message="Demo data." />);

    expect(screen.getByTestId('error-banner')).toHaveAttribute('data-severity', 'info');
    expect(screen.getByText('Demo data.')).toBeInTheDocument();
  });
});
