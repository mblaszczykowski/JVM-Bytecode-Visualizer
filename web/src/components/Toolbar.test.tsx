import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleOptions } from './__fixtures__/factorial-run';
import { closeGlossary } from './glossary-store';
import { Toolbar, type CompilerStatus } from './Toolbar';

afterEach(() => {
  act(() => {
    closeGlossary();
  });
});

/** The four options App builds from the shipped manifest. */
const examples = exampleOptions();

function renderToolbar(compilerStatus: CompilerStatus = 'hidden', onWriteJava?: () => void) {
  const onExampleSelected = vi.fn();
  const onFileSelected = vi.fn();

  render(
    <Toolbar
      appName="JVM Bytecode Visualizer"
      examples={examples}
      selectedExampleId="factorial"
      onExampleSelected={onExampleSelected}
      onFileSelected={onFileSelected}
      compilerStatus={compilerStatus}
      onWriteJava={onWriteJava}
    />,
  );

  return { onExampleSelected, onFileSelected };
}

describe('Toolbar', () => {
  it('names the application and offers the examples and the file picker', () => {
    renderToolbar();

    expect(
      screen.getByRole('heading', { level: 1, name: 'JVM Bytecode Visualizer' }),
    ).toBeVisible();
    expect(screen.getByRole('radiogroup', { name: 'Example programs' })).toBeInTheDocument();
    expect(screen.getByText('Open .class…')).toBeInTheDocument();
  });

  it('reports the selected example', () => {
    const { onExampleSelected } = renderToolbar();

    expect(screen.getByRole('radio', { name: 'Factorial', checked: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'GCD' }));

    expect(onExampleSelected).toHaveBeenCalledWith('gcd');
  });

  it('hides the compiler badge until a compile backend is configured', () => {
    renderToolbar('hidden');

    expect(screen.queryByTestId('compiler-health')).not.toBeInTheDocument();
  });

  it('shows the compiler badge with its health once the backend is configured', () => {
    renderToolbar('online');

    expect(screen.getByTestId('compiler-health')).toHaveAttribute('data-status', 'online');
    expect(screen.getByText('Compiler')).toBeInTheDocument();
  });

  it('offers the editor only when there is a compiler behind it', () => {
    renderToolbar();

    expect(screen.queryByRole('button', { name: 'Write Java…' })).not.toBeInTheDocument();
  });

  it('carries the glossary in every state of the application', () => {
    renderToolbar();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toolbar-glossary'));

    expect(screen.getByRole('dialog', { name: 'Glossary' })).toBeInTheDocument();
  });

  it('opens the editor from the toolbar', () => {
    const onWriteJava = vi.fn();
    renderToolbar('online', onWriteJava);

    fireEvent.click(screen.getByRole('button', { name: 'Write Java…' }));

    expect(onWriteJava).toHaveBeenCalledOnce();
  });
});
