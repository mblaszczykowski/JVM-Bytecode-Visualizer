import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LoadingPanels } from './LoadingPanels';

describe('LoadingPanels', () => {
  it('announces what is being loaded', () => {
    render(<LoadingPanels label="Loading Factorial" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading Factorial');
    expect(screen.getAllByTestId('panel-skeleton')).toHaveLength(3);
  });

  it('offers no way out of a run that could not be stopped anyway', () => {
    render(<LoadingPanels label="Loading Factorial" />);

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('loading-steps')).not.toBeInTheDocument();
  });

  it('lets a run that can be stopped be given up on', () => {
    const onCancel = vi.fn();
    render(<LoadingPanels label="Re-running with 500,000 steps" onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('counts the steps out as they arrive, so a long handover looks alive', () => {
    render(<LoadingPanels label="Re-running with 500,000 steps" steps={125_000} />);

    expect(screen.getByTestId('loading-steps')).toHaveTextContent('125,000 steps');
    // The count is not part of the announcement: two dozen updates would be noise, and the
    // label has already said what is happening.
    expect(screen.getByRole('status')).toHaveTextContent('Re-running with 500,000 steps');
    expect(screen.getByRole('status')).not.toHaveTextContent('125,000');
  });
});
