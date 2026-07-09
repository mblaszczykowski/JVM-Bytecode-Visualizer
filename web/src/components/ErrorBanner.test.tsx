import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('ogłasza błąd jako alert', () => {
    render(<ErrorBanner severity="error" message="ArithmeticException: / by zero (pc 14)" />);

    const banner = screen.getByTestId('error-banner');

    expect(banner).toHaveAttribute('data-severity', 'error');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('ArithmeticException: / by zero (pc 14)');
    expect(banner).toHaveTextContent('Błąd');
  });

  it('używa łagodniejszego wariantu dla ostrzeżenia', () => {
    render(<ErrorBanner severity="warning" message="Przerwano po 20 000 krokach." />);

    const banner = screen.getByRole('status');

    expect(banner).toHaveAttribute('data-severity', 'warning');
    expect(banner).toHaveTextContent('Ostrzeżenie');
  });

  it('renderuje wariant informacyjny', () => {
    render(<ErrorBanner severity="info" message="Dane demonstracyjne." />);

    expect(screen.getByTestId('error-banner')).toHaveAttribute('data-severity', 'info');
    expect(screen.getByText('Dane demonstracyjne.')).toBeInTheDocument();
  });
});
