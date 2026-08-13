import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { closeGlossary, openGlossary } from '../../services/glossary-store';

import { GlossaryDialog } from './GlossaryDialog';
import { GlossaryButton } from '../chrome/GlossaryButton';

function renderWithTrigger() {
  render(
    <>
      <GlossaryButton term="operand-stack" />
      <GlossaryDialog />
    </>,
  );

  const trigger = screen.getByRole('button', { name: 'What is the operand stack?' });
  trigger.focus();
  fireEvent.click(trigger);

  return trigger;
}

function focusableInDialog(): readonly HTMLElement[] {
  return within(screen.getByRole('dialog')).getAllByRole('button');
}

describe('GlossaryDialog', () => {
  it('stays out of the way until a term is asked for', () => {
    render(<GlossaryDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens at the term the reader asked about, named and modal', () => {
    renderWithTrigger();

    const dialog = screen.getByRole('dialog', { name: 'Glossary' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'operand-stack');
    expect(dialog).toHaveTextContent('JVMS §2.6.2');
    expect(dialog).toHaveTextContent('docs/jvm-primer.md');
  });

  it('takes the focus and hands it back to whatever opened it', () => {
    const trigger = renderWithTrigger();

    expect(screen.getByRole('dialog')).toHaveFocus();

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps Tab inside itself, in both directions', () => {
    renderWithTrigger();

    const dialog = screen.getByRole('dialog');
    const controls = focusableInDialog();
    const first = controls[0] ?? document.body;
    const last = controls.at(-1) ?? document.body;

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('reads across to a related term without leaving the dialog', () => {
    renderWithTrigger();

    fireEvent.click(
      within(screen.getByTestId('glossary-entry')).getByRole('button', { name: 'Frame' }),
    );

    expect(screen.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'frame');
    expect(screen.getByRole('dialog')).toHaveTextContent('max_locals');
  });

  it('lists every term, so one door leads to all of them', () => {
    renderWithTrigger();

    const terms = within(screen.getByRole('navigation', { name: 'Glossary terms' }));
    fireEvent.click(terms.getByRole('button', { name: 'Descriptor' }));

    expect(screen.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'descriptor');
    expect(terms.getByRole('button', { name: 'Descriptor' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('closes from the Close button', () => {
    renderWithTrigger();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('holds on to the keys the transport listens for', () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    renderWithTrigger();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    expect(onWindowKey).not.toHaveBeenCalled();

    act(() => {
      closeGlossary();
    });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(onWindowKey).toHaveBeenCalledOnce();

    window.removeEventListener('keydown', onWindowKey);
  });

  it('opens at the first term when the reader asked for the glossary rather than a word', () => {
    render(<GlossaryDialog />);

    act(() => {
      openGlossary();
    });

    expect(screen.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'operand-stack');
  });
});
