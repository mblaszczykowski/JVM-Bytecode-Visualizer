import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CompileDiagnostic } from '../../services/loading/compile-client';

import { CompileEditor, SEED_SOURCE } from './CompileEditor';

interface Options {
  readonly diagnostics?: readonly CompileDiagnostic[];
  readonly isCompiling?: boolean;
}

function renderEditor({ diagnostics = [], isCompiling = false }: Options = {}) {
  const onCompile = vi.fn();
  const onClose = vi.fn();

  function Host() {
    const [source, setSource] = useState(SEED_SOURCE);
    return (
      <CompileEditor
        source={source}
        onSourceChange={setSource}
        diagnostics={diagnostics}
        isCompiling={isCompiling}
        onCompile={onCompile}
        onClose={onClose}
      />
    );
  }

  const { unmount } = render(<Host />);
  return { onCompile, onClose, unmount, textarea: screen.getByLabelText('Java source') };
}

describe('CompileEditor', () => {
  it('starts from a program that compiles and runs as it stands', () => {
    const { textarea, onCompile } = renderEditor();

    expect(textarea).toHaveValue(SEED_SOURCE);
    expect(textarea).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));

    expect(onCompile).toHaveBeenCalledOnce();
  });

  it('seeds a program the summary can read and the console panel can show', () => {
    expect(SEED_SOURCE).toMatch(/\bint result\b/);
    expect(SEED_SOURCE).toMatch(/\bSystem\.out\.println\(/);
  });

  it('states the boundary next to the button that submits the source', () => {
    renderEditor();

    expect(screen.getByText(/Static methods/)).toHaveTextContent(
      'Static methods called from main: ints, int arrays, Math and System.out, nothing else.',
    );
  });

  it('keeps what was typed', () => {
    const { textarea } = renderEditor();

    fireEvent.change(textarea, { target: { value: 'public class Sum { }' } });

    expect(textarea).toHaveValue('public class Sum { }');
  });

  it('says it is working and refuses a second submission while it is', () => {
    const { onCompile } = renderEditor({ isCompiling: true });

    const button = screen.getByRole('button', { name: 'Compiling…' });

    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onCompile).not.toHaveBeenCalled();
  });

  it('lists diagnostics with their position and kind', () => {
    renderEditor({
      diagnostics: [
        { line: 4, column: 12, kind: 'error', message: "';' expected" },
        { line: 7, column: undefined, kind: 'warning', message: 'unchecked call' },
        { line: undefined, column: undefined, kind: 'note', message: 'recompile with -Xlint' },
      ],
    });

    const rows = screen.getAllByTestId('compile-diagnostic');

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("4:12';' expected");
    expect(rows[0]).toHaveAttribute('data-kind', 'error');
    expect(rows[0]).toHaveClass('text-error');
    expect(rows[1]).toHaveTextContent('7unchecked call');
    expect(rows[2]).toHaveTextContent('–recompile with -Xlint');
  });

  it('shows nothing where the diagnostics go until there are some', () => {
    renderEditor();

    expect(screen.queryByTestId('compile-diagnostic')).not.toBeInTheDocument();
  });

  it('closes on Escape and on the button', () => {
    const { onClose, textarea } = renderEditor();

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('hands the focus back to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount, textarea } = renderEditor();
    expect(textarea).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('is named by its own heading, and does not claim to be modal', () => {
    renderEditor();

    const editor = screen.getByRole('dialog', { name: 'Write Java' });

    expect(editor).not.toHaveAttribute('aria-modal');
    expect(screen.getByRole('heading', { name: 'Write Java' })).toBeInTheDocument();
  });

  it('keeps Tab inside itself, so the toolbar behind it stays out of reach', () => {
    renderEditor();

    const controls = screen.getAllByRole('button');
    const first = screen.getByRole('button', { name: 'Close' });
    const last = controls.at(-1);

    last?.focus();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('holds on to the keys the transport listens for', () => {
    const onWindowKey = vi.fn();
    const { textarea } = renderEditor();

    window.addEventListener('keydown', onWindowKey);
    fireEvent.keyDown(textarea, { key: 'ArrowRight' });
    window.removeEventListener('keydown', onWindowKey);

    expect(onWindowKey).not.toHaveBeenCalled();
  });
});
