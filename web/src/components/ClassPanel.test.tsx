import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { parseClassFile, type ClassFile, type FieldInfo } from '../core/classfile';
import { syntheticClass } from '../core/interpreter/__fixtures__/synthetic-class';
import { readExampleBytes, readFixtureBytes } from '../services/__fixtures__/example-files';
import { buildProgram, type LoadedProgram } from '../services/program';

import { ClassPanel } from './ClassPanel';

function programOf(classFile: ClassFile, fileName: string): LoadedProgram {
  return buildProgram({ origin: { kind: 'upload', fileName }, classFile });
}

const libraryClass = parseClassFile(readFixtureBytes('Library.class'));
const library = programOf(libraryClass, 'Library.class');

const factorialClass = parseClassFile(readExampleBytes('Factorial.class'));
const factorial = programOf(factorialClass, 'Factorial.class');

type ExtraProps = Partial<Parameters<typeof ClassPanel>[0]>;

function renderPanel(program: LoadedProgram, extra?: ExtraProps) {
  return render(
    <ClassPanel
      classFile={program.classFile}
      methods={program.methods}
      selectedMethod={program.entry}
      onSelectMethod={vi.fn()}
      entryMethod={program.entry}
      {...extra}
    />,
  );
}

function factOf(label: string): HTMLElement {
  const fact = screen
    .getAllByTestId('class-fact')
    .find((element) => element.dataset.fact === label);
  if (fact === undefined) {
    throw new Error(`No class fact rendered for ${label}`);
  }
  return fact;
}

describe('ClassPanel', () => {
  it('names the panel and counts what the class file carries', () => {
    renderPanel(library);

    expect(screen.getByRole('region', { name: 'Class file' })).toBeInTheDocument();
    expect(screen.getByTestId('class-panel')).toBeInTheDocument();
    expect(screen.getByText('Library · 24 constants')).toBeInTheDocument();
  });

  it('reads the class header, with the Java release the version stands for', () => {
    renderPanel(library);

    expect(within(factOf('this_class')).getByText('Library')).toBeInTheDocument();
    expect(within(factOf('super_class')).getByText('java/lang/Object')).toBeInTheDocument();
    expect(within(factOf('version')).getByText('65.0')).toBeInTheDocument();
    expect(within(factOf('version')).getByText('class file format of Java 21')).toBeInTheDocument();
    expect(within(factOf('access_flags')).getByText('public final super')).toBeInTheDocument();
  });

  it('shows a class with no runnable method in full, method table and pool included', () => {
    renderPanel(library, { selectedMethod: undefined, entryMethod: undefined });

    expect(screen.getAllByTestId('method-row')).toHaveLength(3);
    expect(screen.getAllByText('listing only')).toHaveLength(3);
    expect(screen.getAllByTestId('constant-row')).toHaveLength(24);
  });

  it('replaces the title with the panel switch when one is given', () => {
    renderPanel(library, { titleControl: <button type="button">Class</button> });

    expect(screen.getByRole('region', { name: 'Class file' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Class' })).toBeInTheDocument();
  });

  it('omits the field section for a class that declares no fields', () => {
    renderPanel(library);

    expect(screen.queryByText('Fields')).not.toBeInTheDocument();
    expect(screen.queryByTestId('field-row')).not.toBeInTheDocument();
  });

  it('reads a field descriptor as its Java type, keeping the raw one available', () => {
    const fields: readonly FieldInfo[] = [
      { name: 'counts', descriptor: '[I', accessFlags: 0x000a },
    ];
    const withFields: ClassFile = { ...syntheticClass({ methods: [] }), fields };
    renderPanel(programOf(withFields, 'Synthetic.class'));

    const field = screen.getByTestId('field-row');
    expect(within(field).getByText('private static')).toBeInTheDocument();
    expect(within(field).getByText('counts')).toBeInTheDocument();
    expect(within(field).getByText('int[]')).toBeInTheDocument();
    expect(field).toHaveAttribute('title', 'descriptor [I');
  });

  it('follows a constant pool index out of the panel', () => {
    const onSelectConstant = vi.fn();
    renderPanel(factorial, { selectedConstant: 7, onSelectConstant });

    const methodref = screen
      .getAllByTestId('constant-row')
      .find((row) => row.dataset.index === '7');
    expect(methodref).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Follow constant pool entry #8' }));

    expect(onSelectConstant).toHaveBeenCalledWith(8);
  });

  it('selects a method without starting a run, and runs one only on request', () => {
    const onSelectMethod = vi.fn();
    const onRunMethod = vi.fn();
    renderPanel(factorial, { onSelectMethod, onRunMethod });

    fireEvent.click(screen.getByRole('button', { name: 'Run main([Ljava/lang/String;)V' }));
    expect(onRunMethod).toHaveBeenCalledWith(factorial.entry);
    expect(onSelectMethod).not.toHaveBeenCalled();
  });
});
