import { useEffect, useState } from 'react';

/**
 * Catches files dropped anywhere in the window.
 *
 * Without this the browser's own handler wins for every pixel outside the small drop zone:
 * it navigates the tab to the dropped file, which throws the whole session away — the run,
 * the position in it, and any source in the editor. The listeners also make the entire shell
 * a valid target, so aiming at the zone stops being a requirement.
 *
 * @param onFileDropped receives the first file of a drop landing outside a zone of its own
 * @returns whether a file is currently being dragged over the window
 */
export function useFileDropGuard(onFileDropped: (file: File) => void): boolean {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Same counting problem as inside the drop zone: every element crossed fires a leave.
    let depth = 0;

    function carriesFiles(event: DragEvent): boolean {
      return event.dataTransfer?.types.includes('Files') ?? false;
    }

    function handleDragEnter(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      depth += 1;
      setIsDragging(true);
    }

    function handleDragOver(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      // Both are required for the drop to reach this listener at all.
      event.preventDefault();
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }

    function handleDragLeave(event: DragEvent): void {
      if (!carriesFiles(event)) {
        return;
      }
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setIsDragging(false);
      }
    }

    function handleDrop(event: DragEvent): void {
      depth = 0;
      setIsDragging(false);
      if (!carriesFiles(event)) {
        return;
      }
      // A drop the zone already handled stopped propagating before it got here.
      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (file !== undefined) {
        onFileDropped(file);
      }
    }

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onFileDropped]);

  return isDragging;
}
