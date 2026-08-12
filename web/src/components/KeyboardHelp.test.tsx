import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { KeyboardHelp, type ShortcutGroup } from './KeyboardHelp';

const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Transport',
    shortcuts: [
      { keys: ['Space'], label: 'Play or pause' },
      { keys: ['Shift', '→'], label: 'Step over the call' },
    ],
  },
];

function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
}

describe('KeyboardHelp', () => {
  it('stays closed until it is asked for', () => {
    render(<KeyboardHelp groups={GROUPS} />);

    expect(screen.queryByTestId('keyboard-help')).not.toBeInTheDocument();
  });

  it('opens from the toolbar button', () => {
    render(<KeyboardHelp groups={GROUPS} />);

    openSheet();

    expect(screen.getByTestId('keyboard-help')).toBeInTheDocument();
    expect(screen.getByText('Step over the call')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transport' })).toBeInTheDocument();
  });

  it('renders a chord as separate keycaps', () => {
    render(<KeyboardHelp groups={GROUPS} />);

    openSheet();

    const caps = screen.getAllByText(/^(Shift|→)$/).map((cap) => cap.textContent);
    expect(caps).toEqual(['Shift', '→']);
  });

  it('opens on ?', () => {
    render(<KeyboardHelp groups={GROUPS} />);

    fireEvent.keyDown(window, { key: '?' });

    expect(screen.getByTestId('keyboard-help')).toBeInTheDocument();
  });

  it('leaves ? alone while a text field has the focus', () => {
    render(
      <>
        <textarea aria-label="Java source" />
        <KeyboardHelp groups={GROUPS} />
      </>,
    );
    const editor = screen.getByLabelText('Java source');
    editor.focus();

    fireEvent.keyDown(editor, { key: '?' });

    expect(screen.queryByTestId('keyboard-help')).not.toBeInTheDocument();
  });

  it('yields to a dialog that is already up', () => {
    render(
      <>
        <div role="dialog" aria-label="Glossary" />
        <KeyboardHelp groups={GROUPS} />
      </>,
    );

    fireEvent.keyDown(window, { key: '?' });

    expect(screen.queryByTestId('keyboard-help')).not.toBeInTheDocument();
  });

  it('closes on Escape and hands the focus back to what opened it', () => {
    render(<KeyboardHelp groups={GROUPS} />);
    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    trigger.focus();

    openSheet();
    fireEvent.keyDown(screen.getByTestId('keyboard-help'), { key: 'Escape' });

    expect(screen.queryByTestId('keyboard-help')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on the Close button', () => {
    render(<KeyboardHelp groups={GROUPS} />);

    openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByTestId('keyboard-help')).not.toBeInTheDocument();
  });

  it('keeps Tab inside itself, in both directions', () => {
    render(<KeyboardHelp groups={GROUPS} />);
    openSheet();

    const sheet = screen.getByTestId('keyboard-help');
    const close = screen.getByRole('button', { name: 'Close' });

    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(close).toHaveFocus();

    sheet.focus();
    fireEvent.keyDown(sheet, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
  });

  it('takes the focus when it opens', () => {
    render(<KeyboardHelp groups={GROUPS} />);
    openSheet();

    expect(screen.getByTestId('keyboard-help')).toHaveFocus();
  });

  it('keeps the transport from acting on keys pressed over the sheet', () => {
    const onKeyDown = vi.fn();
    render(<KeyboardHelp groups={GROUPS} />);
    openSheet();

    window.addEventListener('keydown', onKeyDown);
    fireEvent.keyDown(screen.getByTestId('keyboard-help'), { key: ' ' });
    window.removeEventListener('keydown', onKeyDown);

    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
