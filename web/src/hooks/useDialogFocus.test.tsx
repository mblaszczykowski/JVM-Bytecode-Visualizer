import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
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

function FocusDialog({ children }: { readonly children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, () => undefined);
  return (
    <div ref={ref} role="dialog" tabIndex={-1}>
      {children}
    </div>
  );
}

describe('useDialogFocus', () => {
  it('keeps Tab inside a dialog with no tabbable controls', () => {
    render(<FocusDialog />);
    const dialog = screen.getByRole('dialog');

    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(dialog).toHaveFocus();
  });

  it('skips hidden and inert controls when wrapping focus', () => {
    render(
      <FocusDialog>
        <button type="button" hidden>
          Hidden
        </button>
        <div style={{ display: 'none' }}>
          <button type="button">Collapsed</button>
        </div>
        <button type="button" style={{ visibility: 'hidden' }}>
          Invisible
        </button>
        <button type="button">Visible</button>
      </FocusDialog>,
    );
    const visible = screen.getByRole('button', { name: 'Visible' });
    visible.focus();

    fireEvent.keyDown(visible, { key: 'Tab' });
    expect(visible).toHaveFocus();
    fireEvent.keyDown(visible, { key: 'Tab', shiftKey: true });
    expect(visible).toHaveFocus();
  });

  it('returns focus from outside the dialog to its first control', () => {
    render(
      <>
        <button type="button">Outside</button>
        <FocusDialog>
          <button type="button">Inside</button>
        </FocusDialog>
      </>,
    );
    const outside = screen.getByRole('button', { name: 'Outside' });
    outside.focus();

    fireEvent.keyDown(outside, { key: 'Tab' });

    expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus();
  });

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
