import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '../chrome/AppShell';
import { LoadingPanels } from './LoadingPanels';

function renderInShell(panels: ReactNode) {
  return render(
    <AppShell toolbar={null} footer={null}>
      {panels}
    </AppShell>,
  );
}

describe('LoadingPanels', () => {
  it('writes what is being loaded into a live region that was already there', () => {
    const view = renderInShell(null);
    const region = screen.getByTestId('app-status');

    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();

    view.rerender(
      <AppShell toolbar={null} footer={null}>
        <LoadingPanels label="Loading Factorial" />
      </AppShell>,
    );

    expect(screen.getByTestId('app-status')).toHaveTextContent('Loading Factorial');
    expect(screen.getAllByTestId('panel-skeleton')).toHaveLength(3);
  });

  it('clears the region again once the load is over', () => {
    const view = renderInShell(<LoadingPanels label="Loading Factorial" />);

    view.rerender(
      <AppShell toolbar={null} footer={null}>
        {null}
      </AppShell>,
    );

    expect(screen.getByTestId('app-status')).toBeEmptyDOMElement();
  });

  it('adds no second live region of its own', () => {
    renderInShell(<LoadingPanels label="Loading Factorial" />);

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByTestId('loading-label')).toHaveTextContent('Loading Factorial');
  });

  it('offers no way out of a run that could not be stopped anyway', () => {
    renderInShell(<LoadingPanels label="Loading Factorial" />);

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('loading-steps')).not.toBeInTheDocument();
  });

  it('lets a run that can be stopped be given up on', () => {
    const onCancel = vi.fn();
    renderInShell(<LoadingPanels label="Re-running with 500,000 steps" onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('holds the skeleton still for a reader who asked for less motion', () => {
    renderInShell(<LoadingPanels label="Loading Factorial" />);

    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(
      document.querySelectorAll(String.raw`.motion-safe\:animate-pulse`).length,
    ).toBeGreaterThan(0);
  });

  it('counts the steps out as they arrive, so a long handover looks alive', () => {
    renderInShell(<LoadingPanels label="Re-running with 500,000 steps" steps={125_000} />);

    expect(screen.getByTestId('loading-steps')).toHaveTextContent('125,000 steps');
    expect(screen.getByRole('status')).toHaveTextContent('Re-running with 500,000 steps');
    expect(screen.getByRole('status')).not.toHaveTextContent('125,000');
  });
});
