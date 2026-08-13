import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseClassFile } from '../../core/classfile';
import { readFixtureBytes } from '../../services/__fixtures__/example-files';
import { buildProgram, type LoadedProgram, type MethodListing } from '../../services/program';

import { MethodPicker } from './MethodPicker';

function programOf(fileName: string): LoadedProgram {
  return buildProgram({
    origin: { kind: 'upload', fileName },
    classFile: parseClassFile(readFixtureBytes(fileName)),
  });
}

const library = programOf('Library.class');
const counter = programOf('Counter.class');

function methodOf(program: LoadedProgram, signature: string): MethodListing {
  const method = program.methods.find((entry) => `${entry.name}${entry.descriptor}` === signature);
  if (method === undefined) {
    throw new Error(`${signature} is not declared by the fixture`);
  }
  return method;
}

function rowOf(signature: string): HTMLElement {
  const row = screen
    .getAllByTestId('method-row')
    .find((element) => element.dataset.method === signature);
  if (row === undefined) {
    throw new Error(`No row rendered for ${signature}`);
  }
  return row;
}

function selectControlOf(signature: string): HTMLElement {
  const control = within(rowOf(signature)).getAllByRole('button')[0];
  if (control === undefined) {
    throw new Error(`${signature} has no control to select it with`);
  }
  return control;
}

describe('MethodPicker', () => {
  it('lists every declared method in declaration order, with its descriptor', () => {
    render(<MethodPicker methods={library.methods} selected={undefined} onSelect={vi.fn()} />);

    expect(screen.getAllByTestId('method-row').map((row) => row.dataset.method)).toEqual([
      '<init>()V',
      'twice(I)I',
      'clamp(III)I',
    ]);
    expect(within(rowOf('twice(I)I')).getByText('(I)I')).toBeInTheDocument();
    expect(within(rowOf('clamp(III)I')).getByText('(III)I')).toBeInTheDocument();
  });

  it('marks every method of a class with no entry point as listing only, and offers no run', () => {
    render(
      <MethodPicker
        methods={library.methods}
        selected={undefined}
        onSelect={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(screen.getAllByText('listing only')).toHaveLength(library.methods.length);
    expect(screen.queryByRole('button', { name: /^Run / })).not.toBeInTheDocument();
  });

  it('says why a method cannot be run instead of leaving the verdict unexplained', () => {
    render(<MethodPicker methods={library.methods} selected={undefined} onSelect={vi.fn()} />);

    expect(selectControlOf('<init>()V')).toHaveAccessibleName(
      /Listing only: an instance method; a run needs a static entry point/,
    );
    expect(
      within(rowOf('twice(I)I')).getByText(
        /its descriptor is outside the int-only subset this machine executes/,
      ),
    ).toBeInTheDocument();
  });

  it('gives a screen reader the reason once, not once per element of the row', () => {
    render(<MethodPicker methods={library.methods} selected={undefined} onSelect={vi.fn()} />);

    const row = rowOf('<init>()V');
    const reason = 'an instance method; a run needs a static entry point';

    expect(row).not.toHaveAttribute('title');
    expect(within(row).getAllByText(new RegExp(reason))).toHaveLength(1);
  });

  it('offers Run for a runnable method and starts the run with it', () => {
    const onRun = vi.fn();
    const onSelect = vi.fn();
    render(
      <MethodPicker
        methods={counter.methods}
        selected={undefined}
        onSelect={onSelect}
        onRun={onRun}
      />,
    );

    expect(screen.getAllByRole('button', { name: /^Run / })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run count()I' }));

    expect(onRun).toHaveBeenCalledWith(methodOf(counter, 'count()I'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the listing of a method that cannot be run, without ever starting one', () => {
    const onRun = vi.fn();
    const onSelect = vi.fn();
    render(
      <MethodPicker
        methods={counter.methods}
        selected={undefined}
        onSelect={onSelect}
        onRun={onRun}
      />,
    );

    fireEvent.click(selectControlOf('step(I)I'));

    expect(onSelect).toHaveBeenCalledWith(methodOf(counter, 'step(I)I'));
    expect(onRun).not.toHaveBeenCalled();
  });

  it('distinguishes the reader position from the method the run started at', () => {
    render(
      <MethodPicker
        methods={counter.methods}
        selected={methodOf(counter, 'step(I)I')}
        onSelect={vi.fn()}
        entry={counter.entry}
      />,
    );

    expect(selectControlOf('step(I)I')).toHaveAttribute('aria-current', 'true');

    const entry = rowOf('count()I');
    expect(within(entry).getByText('entry')).toBeInTheDocument();
    expect(selectControlOf('count()I')).not.toHaveAttribute('aria-current');
  });

  it('renders the modifiers and the instruction count of each method', () => {
    render(<MethodPicker methods={counter.methods} selected={undefined} onSelect={vi.fn()} />);

    const step = within(rowOf('step(I)I'));
    expect(step.getByText('static')).toBeInTheDocument();
    expect(step.getByText('4 instructions')).toBeInTheDocument();
  });

  it('renders a method with no Code attribute and lets it be selected', () => {
    const onSelect = vi.fn();
    const abstractMethod: MethodListing = {
      name: 'size',
      descriptor: '()I',
      accessFlags: 0x0401,
      maxStack: 0,
      maxLocals: 0,
      instructions: [],
      indexByOffset: new Map(),
      undecodedFromOffset: undefined,
      lineNumbers: [],
      localVariables: [],
      executedOffsets: new Set(),
      notRunnable: 'no-code',
    };
    render(<MethodPicker methods={[abstractMethod]} selected={undefined} onSelect={onSelect} />);

    const row = within(rowOf('size()I'));
    expect(row.getByText('public abstract')).toBeInTheDocument();
    expect(row.queryByText(/instruction/)).not.toBeInTheDocument();

    fireEvent.click(selectControlOf('size()I'));
    expect(onSelect).toHaveBeenCalledWith(abstractMethod);
  });

  it('says so when the class declares no methods at all', () => {
    render(<MethodPicker methods={[]} selected={undefined} onSelect={vi.fn()} />);

    expect(screen.getByText('This class declares no methods.')).toBeInTheDocument();
  });
});
