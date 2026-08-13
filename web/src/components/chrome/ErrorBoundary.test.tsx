import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Exploding(): never {
  throw new Error('render failed');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children while nothing throws', () => {
    render(
      <ErrorBoundary fallback={() => <p>fallback</p>}>
        <p>panels</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('panels')).toBeInTheDocument();
  });

  it('replaces a failed render with the fallback instead of a blank screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary fallback={(error) => <p>caught: {error.message}</p>}>
        <Exploding />
      </ErrorBoundary>,
    );

    expect(screen.getByText('caught: render failed')).toBeInTheDocument();
  });
});
