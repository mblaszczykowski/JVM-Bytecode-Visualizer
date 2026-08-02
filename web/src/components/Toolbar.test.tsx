import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exampleOptions } from './__fixtures__/factorial-run';
import { closeGlossary } from './glossary-store';
import { Toolbar, type CompilerStatus, type PanelName } from './Toolbar';

afterEach(() => {
  act(() => {
    closeGlossary();
  });
});

/** The four options App builds from the shipped manifest. */
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

/** The zone row: name, examples, actions — the only child of the header above the switch. */
function zones(): HTMLElement {
  const row = screen.getByRole('banner').firstElementChild;
  if (!(row instanceof HTMLElement)) {
    throw new Error('the toolbar has no zone row');
  }
  return row;
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

  it('gives the name, the examples and the actions a zone each', () => {
    renderToolbar('online', vi.fn());

    // Three tracks from `md` up, and only the middle one may shrink: the actions cannot be
    // pushed onto a line of their own, so the header keeps its height (design.md §6.1).
    expect(zones().className).toContain('md:grid-cols-[auto_minmax(0,1fr)_auto]');

    const examplesZone = screen.getByRole('radiogroup', { name: 'Example programs' }).parentElement
      ?.parentElement;
    expect(examplesZone?.className).toContain('min-w-0');
    expect(examplesZone?.className).toContain('md:row-start-1');
  });

  it('keeps the drop hint next to the file picker', () => {
    renderToolbar();

    // Hidden on narrow screens, but by a breakpoint rather than by falling out of a row.
    expect(screen.getByText('or drop it here').className).toContain('lg:inline');
  });

  it('takes a line of its own for the panel switch, and only while the panels share a cell', () => {
    const onSelect = vi.fn();
    renderToolbar('hidden', undefined, { selected: 'bytecode', onSelect });

    const panelSwitch = screen.getByTestId('panel-switch');
    expect(panelSwitch.className).toContain('md:hidden');
    expect(panelSwitch.parentElement).toBe(screen.getByRole('banner'));

    fireEvent.click(screen.getByRole('button', { name: 'State' }));

    expect(onSelect).toHaveBeenCalledWith('state');
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
