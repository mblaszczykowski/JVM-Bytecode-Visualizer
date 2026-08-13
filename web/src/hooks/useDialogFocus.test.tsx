import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useDialogFocus } from './useDialogFocus';

interface DialogProps {
  readonly name: string;
  readonly onClose: () => void;
}

function Dialog({ name, onClose }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useDialogFocus(ref, onClose);

  return (
    <div ref={ref} role="dialog" aria-label={name} tabIndex={-1}>
      <button type="button">{name} action</button>
    </div>
  );
}

interface StackProps {
  readonly innerOpen: boolean;
  readonly onCloseOuter: () => void;
  readonly onCloseInner: () => void;
}

function Stack({ innerOpen, onCloseOuter, onCloseInner }: StackProps) {
  return (
    <>
      <Dialog name="Outer" onClose={onCloseOuter} />
      {innerOpen ? <Dialog name="Inner" onClose={onCloseInner} /> : null}
    </>
  );
}

describe('useDialogFocus', () => {
  it('closes the dialog on top and leaves the one behind it open', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    render(<Stack innerOpen onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onCloseInner).toHaveBeenCalledOnce();
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it('hands Escape back once the dialog on top has gone', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    const { rerender } = render(
      <Stack innerOpen onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />,
    );

    rerender(<Stack innerOpen={false} onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onCloseOuter).toHaveBeenCalledOnce();
    expect(onCloseInner).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
  });
});
