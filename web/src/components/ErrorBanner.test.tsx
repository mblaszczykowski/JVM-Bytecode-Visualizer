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
        message="Stopped after 20 000 steps — the program probably does not terminate. Showing the history up to this point."
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

  it('renders the informational variant', () => {
    render(<ErrorBanner severity="info" message="Demo data." />);

    expect(screen.getByTestId('error-banner')).toHaveAttribute('data-severity', 'info');
    expect(screen.getByText('Demo data.')).toBeInTheDocument();
  });
});
