import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { lineForOffset, type MethodListing } from '../../services/loading/program';

import {
  commentsOf,
  constructorListing,
  factorialListing,
  factorialProgram,
} from '../__fixtures__/factorial-run';
import { BytecodePanel } from './BytecodePanel';
import { GlossaryDialog } from '../dialogs/GlossaryDialog';
import { NUMBER_COLUMN, ROW_HEIGHT } from '../rhythm';

const factorial = factorialListing();
const constructor = constructorListing();
const pool = factorialProgram().classFile.constantPool;

const sourceLineForOffset = new Map(
  factorial.instructions.flatMap((instruction) => {
    const line = lineForOffset(factorial, instruction.offset);
    return line === undefined ? [] : [[instruction.offset, line] as const];
  }),
);

type ExtraProps = Partial<Parameters<typeof BytecodePanel>[0]>;

function rowOf(mnemonic: string): HTMLElement {
  const row = screen.getByText(mnemonic).closest('li');
  if (row === null) {
    throw new Error(`No row rendered for ${mnemonic}`);
  }
  return row;
}

function stackCellOf(mnemonic: string): string | null {
  return within(rowOf(mnemonic)).getByTestId('stack-effect').textContent;
}

function linkedOffsets(): readonly (string | null)[] {
  return screen
    .getAllByTestId(/instruction/)
    .filter((row) => row.getAttribute('data-linked') === 'true')
    .map((row) => row.getAttribute('data-offset'));
}

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
    const descriptor = screen.getByRole('button', { name: '(I)I: What is a descriptor?' });
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
    render(
      <BytecodePanel
        methodName="sync"
        methodDescriptor="()V"
        maxStack={1}
        maxLocals={1}
        instructions={[
          { offset: 0, opcode: 0x2a, mnemonic: 'aload_0', operands: [] },
          { offset: 1, opcode: 0xc2, mnemonic: 'monitorenter', operands: [], unsupported: true },
          { offset: 2, opcode: 0xb1, mnemonic: 'return', operands: [] },
        ]}
        currentOffset={0}
      />,
    );

    expect(within(rowOf('monitorenter')).getByText('unsupported')).toBeInTheDocument();
    expect(rowOf('monitorenter')).toHaveClass('row-unsupported');
    expect(within(rowOf('aload_0')).queryByText('unsupported')).not.toBeInTheDocument();
  });

  it('says nothing about a listing whose every instruction is supported', () => {
    renderListing(constructor, 0);

    expect(screen.queryAllByText('unsupported')).toHaveLength(0);
    expect(screen.getByTestId('current-instruction')).toHaveTextContent('aload_0');
  });

  it('leaves room for the widest offset a Code attribute can hold', () => {
    render(
      <BytecodePanel
        methodName="long"
        methodDescriptor="()V"
        maxStack={0}
        maxLocals={0}
        instructions={[{ offset: 65535, opcode: 0xb1, mnemonic: 'return', operands: [] }]}
        currentOffset={undefined}
      />,
    );

    expect(screen.getByText('65535')).toHaveClass(...NUMBER_COLUMN.split(' '));
  });

  it('colours only the operands that point elsewhere in the class file', () => {
    render(
      <BytecodePanel
        methodName="loop"
        methodDescriptor="(I)V"
        maxStack={2}
        maxLocals={2}
        instructions={[
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
    expect(accented('1')).toBe(false);
  });

  it('seeks to the first step at a row, by pointer and by keyboard', () => {
    const onSeek = vi.fn();
    renderListing(factorial, 0, {
      stepForOffset: new Map([
        [11, 9],
        [14, 12],
      ]),
      onSeek,
    });

    const first = screen.getByRole('button', { name: 'Go to pc 11, invokestatic' });
    fireEvent.click(first);
    expect(onSeek).toHaveBeenCalledWith(9);

    fireEvent.keyDown(first, { key: 'ArrowDown' });

    const second = screen.getByRole('button', { name: 'Go to pc 14, imul' });
    expect(second).toHaveFocus();

    fireEvent.click(second);
    expect(onSeek).toHaveBeenLastCalledWith(12);
  });

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

    fireEvent.click(screen.getByRole('button', { name: '(I)I: What is a descriptor?' }));

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
    renderListing(constructor, 0, { undecodedFromOffset: 5 });

    expect(screen.getByText('… not decoded')).toBeInTheDocument();
  });

  describe('stack effect column', () => {
    it('shows what each instruction takes off the operand stack and leaves behind', () => {
      renderListing(factorial, undefined, { constantPool: pool });

      expect(stackCellOf('imul')).toBe('−2+1');
      expect(stackCellOf('if_icmpgt')).toBe('−2');
      expect(stackCellOf('invokestatic')).toBe('−1+1');
    });

    it('leaves the column empty for an instruction that touches nothing', () => {
      renderListing(constructor, undefined, { constantPool: pool });

      expect(stackCellOf('return')).toBe('');
    });

    it('says varies rather than guessing at an effect that follows a descriptor', () => {
      render(
        <BytecodePanel
          methodName="print"
          methodDescriptor="()V"
          maxStack={2}
          maxLocals={0}
          instructions={[
            { offset: 0, opcode: 0xb2, mnemonic: 'getstatic', operands: [2] },
            { offset: 3, opcode: 0x03, mnemonic: 'iconst_0', operands: [] },
            { offset: 4, opcode: 0xb1, mnemonic: 'return', operands: [] },
          ]}
          currentOffset={undefined}
          constantPool={[]}
        />,
      );

      expect(stackCellOf('getstatic')).toBe('varies');
      expect(stackCellOf('iconst_0')).toBe('+1');
    });

    it('resolves an invokespecial descriptor rather than giving up on it', () => {
      renderListing(constructor, undefined, { constantPool: pool });

      expect(stackCellOf('invokespecial')).toBe('−1');
    });

    it('announces the stack effect of the current instruction', () => {
      renderListing(factorial, 14, { constantPool: pool });

      expect(screen.getByText('pc 14 · imul · stack: pops 2, pushes 1')).toBeInTheDocument();
    });

    it('is left off entirely without a constant pool to resolve descriptors against', () => {
      renderListing(factorial, undefined);

      expect(screen.queryAllByTestId('stack-effect')).toHaveLength(0);
    });
  });

  describe('source line linkage', () => {
    it('reports the line a row compiled from, by pointer and by keyboard', () => {
      const onLinkedLineChange = vi.fn();
      renderListing(factorial, undefined, {
        sourceLineForOffset,
        onLinkedLineChange,
        stepForOffset: new Map([[14, 9]]),
        onSeek: vi.fn(),
      });

      fireEvent.mouseOver(rowOf('imul'));
      expect(onLinkedLineChange).toHaveBeenLastCalledWith(20);

      fireEvent.focus(screen.getByRole('button', { name: 'Go to pc 14, imul' }));
      expect(onLinkedLineChange).toHaveBeenLastCalledWith(20);

      fireEvent.blur(screen.getByRole('button', { name: 'Go to pc 14, imul' }));
      expect(onLinkedLineChange).toHaveBeenLastCalledWith(undefined);
    });

    it('marks every instruction the linked line compiled to', () => {
      renderListing(factorial, undefined, { sourceLineForOffset, linkedLine: 20 });

      expect(linkedOffsets()).toEqual(['7', '8', '9', '10', '11', '14', '15']);
    });

    it('leaves the current instruction to the accent rather than marking it twice', () => {
      renderListing(factorial, 14, { sourceLineForOffset, linkedLine: 20 });

      expect(screen.getByTestId('current-instruction')).not.toHaveAttribute('data-linked');
      expect(linkedOffsets()).toEqual(['7', '8', '9', '10', '11', '15']);
    });
  });
});

describe('what javac was compiling', () => {
  it('tags the row a construct starts on, and only that row', () => {
    const constructs = new Map([
      [2, { label: 'loop', detail: 'The top of a loop.' }],
      [11, { label: 'boxing', detail: 'Wraps a primitive in an object.' }],
    ]);

    renderListing(factorial, undefined, { constructs });

    expect(screen.getAllByTestId('construct-tag').map((tag) => tag.textContent)).toEqual([
      'loop',
      'boxing',
    ]);
    expect(within(rowOf('if_icmpgt')).getByTestId('construct-tag')).toHaveTextContent('loop');
    expect(within(rowOf('imul')).queryByTestId('construct-tag')).not.toBeInTheDocument();
  });

  it('carries the sentence the tag has no room for', () => {
    const constructs = new Map([
      [2, { label: 'loop', detail: 'A backward jump is all a loop is.' }],
    ]);

    renderListing(factorial, undefined, { constructs });

    expect(screen.getByTestId('construct-tag')).toHaveAttribute(
      'title',
      'A backward jump is all a loop is.',
    );
  });

  it('says nothing about a listing it was told nothing about', () => {
    renderListing(factorial, undefined);

    expect(screen.queryByTestId('construct-tag')).not.toBeInTheDocument();
  });
});
