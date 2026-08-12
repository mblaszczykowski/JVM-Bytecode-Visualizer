import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { exampleOptions } from './__fixtures__/factorial-run';
import { GlossaryDialog } from './GlossaryDialog';
import { Toolbar, type CompilerStatus, type PanelName } from './Toolbar';

const examples = exampleOptions();

function renderToolbar(
  compilerStatus: CompilerStatus = 'hidden',
  onWriteJava?: () => void,
  panelSwitch?: { selected: PanelName; onSelect: (panel: PanelName) => void },
) {
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
      panelSwitch={panelSwitch}
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

  it('opens the glossary without owning the dialog itself', () => {
    render(<GlossaryDialog />);
    renderToolbar();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toolbar-glossary'));

    expect(screen.getByRole('dialog', { name: 'Glossary' })).toBeInTheDocument();
  });

  it('offers the file picker without explaining the drop target', () => {
    renderToolbar();

    expect(screen.getByText('Open .class…')).toBeVisible();
    expect(screen.queryByText(/or drop/)).toBeNull();
  });

  it('folds the example picker away and offers the panel switch instead', () => {
    const onSelect = vi.fn();
    renderToolbar('hidden', undefined, { selected: 'bytecode', onSelect });

    expect(screen.getByTestId('example-picker-trigger')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bytecode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'State' }));

    expect(onSelect).toHaveBeenCalledWith('state');
  });

  it('keeps exactly one example radiogroup, folded or not', () => {
    renderToolbar('hidden', undefined, { selected: 'bytecode', onSelect: vi.fn() });

    expect(screen.getAllByRole('radiogroup', { name: 'Example programs' })).toHaveLength(1);
  });

  it('leaves the panel switch out while one view owns the whole width', () => {
    renderToolbar();

    expect(screen.queryByTestId('panel-switch')).not.toBeInTheDocument();
  });

  it('opens the editor from the toolbar', () => {
    const onWriteJava = vi.fn();
    renderToolbar('online', onWriteJava);

    fireEvent.click(screen.getByRole('button', { name: 'Write Java…' }));

    expect(onWriteJava).toHaveBeenCalledOnce();
  });
});
