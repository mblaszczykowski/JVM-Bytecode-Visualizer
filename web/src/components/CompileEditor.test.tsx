import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CompileDiagnostic } from '../services/compile-client';

import { CompileEditor, SEED_SOURCE } from './CompileEditor';

interface Options {
  readonly diagnostics?: readonly CompileDiagnostic[];
  readonly isCompiling?: boolean;
}

/** The draft lives above the editor in the application, so the test owns it here too. */
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

  render(<Host />);
  return { onCompile, onClose, textarea: screen.getByLabelText('Java source') };
}

describe('CompileEditor', () => {
  it('starts from a program that compiles and runs as it stands', () => {
    const { textarea, onCompile } = renderEditor();

    expect(textarea).toHaveValue(SEED_SOURCE);
    expect(textarea).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Compile' }));

    expect(onCompile).toHaveBeenCalledOnce();
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
    expect(rows[2]).toHaveTextContent('—recompile with -Xlint');
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
});
