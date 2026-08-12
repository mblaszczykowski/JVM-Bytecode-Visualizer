import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { capabilitySummary } from '../services/capabilities';

import { CapabilityNote } from './CapabilityNote';

describe('CapabilityNote', () => {
  it('starts closed, so the welcome screen stays one screen', () => {
    render(<CapabilityNote />);

    expect(screen.getByTestId('welcome-capabilities')).not.toHaveAttribute('open');
  });

  it('heads its two columns at the level the welcome screen leaves off', () => {
    render(<CapabilityNote />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Executable instructions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Not implemented yet' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument();
  });

  it('says what will actually happen to a file from a real project', () => {
    render(<CapabilityNote />);

    const summary = screen.getByTestId('welcome-capabilities').querySelector('summary');

    expect(summary).toHaveTextContent(
      /Runs the integer subset of the JVM: \d+ of \d+ instructions\./,
    );
    expect(summary).toHaveTextContent('stop on an instruction this machine does not implement');
  });

  it('quotes the live instruction counts rather than a number written down here', () => {
    const { executable, assigned } = capabilitySummary();
    render(<CapabilityNote />);

    expect(screen.getByText(String(executable))).toBeInTheDocument();
    expect(screen.getByText(String(assigned))).toBeInTheDocument();
  });

  it('opens on a click and closes again', () => {
    render(<CapabilityNote />);
    const note = screen.getByTestId('welcome-capabilities');
    const summary = screen.getByText(/Runs the integer subset of the JVM/);

    fireEvent.click(summary);
    expect(note).toHaveAttribute('open');

    fireEvent.click(summary);
    expect(note).not.toHaveAttribute('open');
  });

  it('puts the disclosure on a summary, so the platform makes it operable', () => {
    render(<CapabilityNote />);

    const summary = screen.getByText(/Runs the integer subset of the JVM/).closest('summary');

    expect(summary).toBeInstanceOf(HTMLElement);
    expect(summary?.parentElement).toBe(screen.getByTestId('welcome-capabilities'));
  });

  it('breaks the executable subset down by family', () => {
    const { families } = capabilitySummary();
    render(<CapabilityNote />);

    const rows = screen.getAllByTestId('capability-family');

    expect(rows).toHaveLength(families.length);
    for (const family of families) {
      expect(screen.getByText(family.name)).toBeInTheDocument();
      expect(screen.getByText(family.mnemonics.join(' '))).toBeInTheDocument();
    }
  });

  it('names the missing Java features in Java terms, with the instructions behind them', () => {
    const { gaps } = capabilitySummary();
    render(<CapabilityNote />);

    const rows = screen.getAllByTestId('capability-gap');

    expect(rows).toHaveLength(gaps.length);
    expect(screen.getByText(/Interfaces, lambdas and method references/)).toHaveTextContent(
      'invokedynamic',
    );
  });

  it('mentions the one limit no opcode expresses: calls never leave the uploaded class', () => {
    render(<CapabilityNote />);

    expect(
      screen.getByText(/Everything must resolve inside the uploaded class/),
    ).toBeInTheDocument();
  });

  it('keeps the open and closed affordances out of the accessible name', () => {
    render(<CapabilityNote />);

    const summary = screen.getByTestId('welcome-capabilities').querySelector('summary');

    for (const label of ['What runs', 'Hide']) {
      expect(screen.getByText(label)).toHaveAttribute('aria-hidden', 'true');
    }
    expect(summary?.textContent).toContain('Runs the integer subset of the JVM');
  });
});
