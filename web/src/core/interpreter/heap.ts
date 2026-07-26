/**
 * The heap of the interpreter (JVMS §2.5.3), holding int arrays and nothing else — the one
 * object kind the executable subset can create (`newarray T_INT`).
 *
 * A reference is a handle: the index of the array in `cells`. Handles are never reused and
 * arrays are never freed, so the heap only grows, which is what lets one snapshot share the
 * frozen objects of the one before it.
 *
 * Mutable during execution; `freeze()` produces the immutable view a snapshot carries.
 */

import { VmFault } from './errors';
import type { ArrayObject } from './types';

/** JVMS §2.4: `null` is a reference value of its own, and no array ever lives at this handle. */
export const NULL_REFERENCE = -1;

interface HeapCell {
  readonly elements: number[];
  /** Bumped by every element write, so `freeze()` re-copies only the arrays that changed. */
  version: number;
}

interface FrozenCell {
  readonly version: number;
  readonly object: ArrayObject;
}

const EMPTY_HEAP: readonly ArrayObject[] = Object.freeze([]);

export class Heap {
  private readonly cells: HeapCell[] = [];
  /** Bumped by every allocation and every store; an untouched heap reuses its frozen view. */
  private revision = 0;
  private readonly frozenCells: FrozenCell[] = [];
  /** Revision the view below was taken at; revision 0 is the empty heap of an int-only run. */
  private frozenRevision = 0;
  private frozenHeap: readonly ArrayObject[] = EMPTY_HEAP;

  /** JVMS §6.5 newarray: a zero-filled array, and the handle that names it from now on. */
  allocateIntArray(length: number): number {
    if (length < 0) {
      throw new VmFault({ kind: 'negative-array-size', size: length });
    }
    this.cells.push({ elements: new Array<number>(length).fill(0), version: 0 });
    this.revision += 1;
    return this.cells.length - 1;
  }

  /** JVMS §6.5 arraylength. */
  lengthOf(reference: number): number {
    return this.cellAt(reference).elements.length;
  }

  /** JVMS §6.5 iaload. */
  loadInt(reference: number, index: number): number {
    const { elements } = this.cellAt(reference);
    const value = elements[index];
    if (value === undefined) {
      throw outOfBounds(index, elements.length);
    }
    return value;
  }

  /** JVMS §6.5 iastore. */
  storeInt(reference: number, index: number, value: number): void {
    const cell = this.cellAt(reference);
    // Writing past the end would silently grow the JS array into something no longer an int[n].
    if (index < 0 || index >= cell.elements.length) {
      throw outOfBounds(index, cell.elements.length);
    }
    cell.elements[index] = value;
    cell.version += 1;
    this.revision += 1;
  }

  /**
   * Frozen view for a snapshot.
   *
   * A step that touched no array hands back the very array it handed back last time, and a
   * step that wrote to one array keeps the frozen objects of all the others. The history
   * therefore costs one element copy per allocation and per mutating step, not one per step
   * per array — the same reasoning that keeps the call stack from being copied every step.
   */
  freeze(): readonly ArrayObject[] {
    if (this.revision === this.frozenRevision) {
      return this.frozenHeap;
    }
    this.frozenHeap = Object.freeze(
      this.cells.map((cell, handle) => this.freezeCell(handle, cell)),
    );
    this.frozenRevision = this.revision;
    return this.frozenHeap;
  }

  private freezeCell(handle: number, cell: HeapCell): ArrayObject {
    const previous = this.frozenCells[handle];
    if (previous?.version === cell.version) {
      return previous.object;
    }

    const object: ArrayObject = Object.freeze({
      kind: 'int-array',
      length: cell.elements.length,
      elements: Object.freeze([...cell.elements]),
    });
    this.frozenCells[handle] = { version: cell.version, object };
    return object;
  }

  /** `null`, a handle from another run, or one that was never allocated: all unusable. */
  private cellAt(reference: number): HeapCell {
    const cell = this.cells[reference];
    if (cell === undefined) {
      throw new VmFault({ kind: 'null-reference' });
    }
    return cell;
  }
}

function outOfBounds(index: number, length: number): VmFault {
  return new VmFault({ kind: 'array-index-out-of-bounds', index, length });
}
