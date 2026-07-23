import { type ChangeEvent, type DragEvent, useId, useRef, useState } from 'react';

/** `compact` is the toolbar pill; `zone` is the drop target on the welcome screen. */
export type FileUploadVariant = 'compact' | 'zone';

interface FileUploadProps {
  /** Only the choice of file. Validation and parsing happen upstream. */
  readonly onFileSelected: (file: File) => void;
  readonly variant?: FileUploadVariant;
}

const CONTAINER: Record<FileUploadVariant, string> = {
  compact: 'flex items-center gap-2 rounded-full p-1',
  zone: 'flex flex-col items-center gap-2 rounded-panel px-6 py-7 shadow-panel',
};

const IDLE_SURFACE: Record<FileUploadVariant, string> = {
  compact: '',
  zone: 'bg-white/[0.03]',
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
      className={`focus-ring-within ${CONTAINER[variant]} transition-colors ${
        isDragging ? 'bg-accent/[0.22]' : IDLE_SURFACE[variant]
      }`}
    >
      <label
        htmlFor={inputId}
        className="cursor-pointer rounded-full bg-white/9 px-3 py-1.5 text-[12px] text-white/80 shadow-control-raised transition-colors hover:bg-white/15"
      >
        Open .class…
      </label>
      {variant === 'zone' ? (
        <span className="text-[11.5px] text-white/55">
          or drop a .class file here — up to 512 KiB, parsed in this tab
        </span>
      ) : (
        <span className="hidden text-[11px] text-white/55 lg:inline">or drop it here</span>
      )}
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
