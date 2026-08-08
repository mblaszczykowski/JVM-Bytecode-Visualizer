import { type ChangeEvent, type DragEvent, useId, useRef, useState } from 'react';

/** `compact` is the toolbar pill; `zone` is the drop target on the welcome screen. */
export type FileUploadVariant = 'compact' | 'zone';

interface FileUploadProps {
  /** Only the choice of file. Validation and parsing happen upstream. */
  readonly onFileSelected: (file: File) => void;
  readonly variant?: FileUploadVariant;
}

/**
 * `compact` pulls its own padding back out of the flow (`-my-1`). The padding is there to give
 * the drag highlight some body around the control, but as the tallest thing in the toolbar it
 * would otherwise set the row height and cost the header its ~48px.
 *
 * `zone` used to be a 140px panel holding one button and one line of text — the largest object
 * on the welcome screen, for the way in that almost nobody takes. It is a strip now.
 */
const CONTAINER: Record<FileUploadVariant, string> = {
  compact: '-my-1 flex shrink-0 items-center gap-2 rounded-control p-1',
  zone: 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-panel px-5 py-4 shadow-panel',
};

const IDLE_SURFACE: Record<FileUploadVariant, string> = {
  compact: '',
  zone: 'bg-panel',
};

export function FileUpload({ onFileSelected, variant = 'compact' }: FileUploadProps) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);
  /**
   * Dragging over a child fires `dragleave` on the parent before `dragenter` on the child,
   * so a naive flag flickers off and on for every element the pointer crosses. Counting
   * enters against leaves means only the drag actually leaving the zone turns it off.
   */
  const depth = useRef(0);

  function handleInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file !== undefined) {
      onFileSelected(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    // The window guard catches everything dropped outside a zone; this one is a zone.
    event.stopPropagation();
    depth.current = 0;
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) {
      onFileSelected(file);
    }
  }

  function handleDragEnter(): void {
    depth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(): void {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) {
      setIsDragging(false);
    }
  }

  return (
    <div
      data-testid="file-drop-zone"
      data-variant={variant}
      data-dragging={isDragging}
      onDrop={handleDrop}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      // The input itself is `sr-only`, so the focus ring has to be drawn around the label.
      className={`focus-ring-within ${CONTAINER[variant]} transition-colors duration-150 ${
        isDragging ? 'bg-accent/12' : IDLE_SURFACE[variant]
      }`}
    >
      <label
        htmlFor={inputId}
        className="text-label cursor-pointer rounded-control bg-raised px-2.5 py-1 text-fg shadow-control-raised transition-colors duration-150 hover:bg-raised-hover"
      >
        Open .class…
      </label>
      {variant === 'zone' ? (
        <span className="text-meta text-fg-3">
          or drop a .class file here — up to 512 KiB, parsed in this tab
        </span>
      ) : null}
      <input
        id={inputId}
        type="file"
        accept=".class,application/java-vm"
        onChange={handleInputChange}
        className="sr-only"
      />
    </div>
  );
}
