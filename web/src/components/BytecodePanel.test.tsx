import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MethodListing } from '../services/program';

import { commentsOf, constructorListing, factorialListing } from './__fixtures__/factorial-run';
import { BytecodePanel } from './BytecodePanel';
import { GlossaryDialog } from './GlossaryDialog';
import { closeGlossary } from './glossary-store';
import { ROW_HEIGHT } from './rhythm';

afterEach(() => {
  act(() => {
    closeGlossary();
  });
});

/** The real disassembly of a method of the committed `Factorial.class`. */
const factorial = factorialListing();
const constructor = constructorListing();

type ExtraProps = Partial<Parameters<typeof BytecodePanel>[0]>;

function renderListing(
  listing: MethodListing,
  currentOffset: number | undefined,
  extra?: ExtraProps,
) {
  return render(
    <BytecodePanel
      methodName={listing.name}
      methodDescriptor={listing.descriptor}
      maxStack={listing.maxStack}
      maxLocals={listing.maxLocals}
      instructions={listing.instructions}
      currentOffset={currentOffset}
      {...extra}
    />,
  );
}

describe('BytecodePanel', () => {
  it('renders the listing of the current method with its signature and Code limits', () => {
    renderListing(factorial, undefined);

    expect(screen.getByRole('region', { name: 'Bytecode' })).toBeInTheDocument();
    // stack=3, locals=1 in the Code attribute javap prints for factorial(int).
    // The descriptor inside it is a way into the glossary, so the line is no longer one node.
    const descriptor = screen.getByRole('button', { name: '(I)I — What is a descriptor?' });
    expect(descriptor.parentElement).toHaveTextContent('factorial(I)I · max 3/1');
    expect(screen.getAllByRole('listitem')).toHaveLength(factorial.instructions.length);
  });

  it('highlights the instruction under the pc of the top frame', () => {
    renderListing(factorial, 11);

    const current = screen.getByTestId('current-instruction');

    expect(current).toHaveAttribute('data-offset', '11');
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('invokestatic');
    expect(screen.getAllByTestId('current-instruction')).toHaveLength(1);
  });

  it('announces the current instruction for assistive technology', () => {
    renderListing(factorial, 11);

    expect(screen.getByText('pc 11 · invokestatic #7')).toBeInTheDocument();
  });

  it('highlights nothing when the call stack is empty', () => {
    renderListing(factorial, undefined);

    expect(screen.queryByTestId('current-instruction')).not.toBeInTheDocument();
    expect(screen.getByText('No active instruction.')).toBeInTheDocument();
  });

  it('shows the absolute jump target instead of the raw delta', () => {
    renderListing(factorial, 2);
    const row = within(screen.getByTestId('current-instruction'));

    expect(row.getByText('if_icmpgt')).toBeInTheDocument();
    // The operand in the stream is the delta 5; the target (2 + 5) is 7, which is what shows.
    expect(row.getByText('7')).toBeInTheDocument();
    expect(row.queryByText('5')).not.toBeInTheDocument();
  });

  it('renders the invokestatic operand as a constant pool reference', () => {
    renderListing(factorial, 11);

    expect(within(screen.getByTestId('current-instruction')).getByText('#7')).toBeInTheDocument();
  });

  it('draws a branch arc spanning the rows between the jump and its target', () => {
    renderListing(factorial, 2);

    const arc = screen.getByTestId('branch-arc');

    // `if_icmpgt` is row 2 and targets offset 7, which is row 5.
    expect(arc).toHaveStyle({ height: `${String((5 - 2) * ROW_HEIGHT)}px` });
  });

  it('shows the resolved constant pool entry as a javap-style comment', () => {
    renderListing(factorial, 11, { comments: commentsOf(factorial) });

    expect(
      within(screen.getByTestId('current-instruction')).getByText(
        '// Method Factorial.factorial:(I)I',
      ),
    ).toBeInTheDocument();
  });

  it('marks instructions outside the supported subset as unsupported', () => {
    // The constructor javac generates: aload_0, invokespecial, return. Only the call to
    // Object.<init> is outside the subset — `aload_0` came in with the array instructions.
    renderListing(constructor, 0);

    expect(screen.getAllByText('unsupported')).toHaveLength(1);
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('aload_0');
  });

  it('colours only the operands that point elsewhere in the class file', () => {
    render(
      <BytecodePanel
        methodName="loop"
        methodDescriptor="(I)V"
        maxStack={2}
        maxLocals={2}
        instructions={[
          // iinc 1, 1 — a local slot and an immediate; neither refers to anything.
          { offset: 0, opcode: 0x84, mnemonic: 'iinc', operands: [1, 1] },
          { offset: 3, opcode: 0xb8, mnemonic: 'invokestatic', operands: [7] },
          { offset: 6, opcode: 0xa7, mnemonic: 'goto', operands: [-6], branchTarget: 0 },
        ]}
        currentOffset={undefined}
      />,
    );

    const accented = (text: string): boolean =>
      screen.getAllByText(text).some((node) => node.className.includes('text-accent-dim'));

    expect(accented('#7')).toBe(true);
    expect(accented('0')).toBe(true);
    // Two `1`s on the iinc row: the slot and the increment, both plain numbers.
    expect(accented('1')).toBe(false);
  });

  it('seeks to the first step at a row, by pointer and by keyboard', () => {
    const onSeek = vi.fn();
    renderListing(factorial, 0, { stepForOffset: new Map([[11, 9]]), onSeek });

    // Only the offsets the run reached are seekable; the rest are read-only rows.
    const targets = within(screen.getByRole('list')).getAllByRole('button');
    expect(targets).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Go to pc 11, invokestatic' }));
    expect(onSeek).toHaveBeenCalledWith(9);
  });

  /** `(I)I` is where a reader first meets the notation, so it is where the notation is explained. */
  it('explains the method descriptor from the descriptor itself', () => {
    render(
      <>
        <BytecodePanel
          methodName={factorial.name}
          methodDescriptor={factorial.descriptor}
          maxStack={factorial.maxStack}
          maxLocals={factorial.maxLocals}
          instructions={factorial.instructions}
          currentOffset={undefined}
        />
        <GlossaryDialog />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: '(I)I — What is a descriptor?' }));

    expect(screen.getByTestId('glossary-entry')).toHaveAttribute('data-term', 'descriptor');
  });

  it('explains any mnemonic on hover, including the rows this run never reached', () => {
    renderListing(factorial, undefined, {
      help: new Map([['imul', 'Pops two ints and pushes their product.']]),
    });

    expect(screen.getByText('imul').closest('li')).toHaveAttribute(
      'title',
      'Pops two ints and pushes their product.',
    );
  });

  it('reports the rest of the method as undecoded after a variable-length instruction', () => {
    renderListing(constructor, 0, { truncatedAtOffset: 5 });

    expect(screen.getByText('… not decoded')).toBeInTheDocument();
  });
});
