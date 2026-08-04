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
import type { HeapObject, ValueKind } from './types';

/** JVMS §2.4: `null` is a reference value of its own, and no array ever lives at this handle. */
export const NULL_REFERENCE = -1;

/**
 * Elements this heap will hold at once, across every array on it.
 *
 * A real JVM answers an impossible `newarray` with OutOfMemoryError; without a bound here the
 * allocation is handed straight to `new Array(n).fill(0)`, and `new int[Integer.MAX_VALUE]` —
 * a class file javac compiles without complaint — takes the whole process down with a V8
 * fatal error, which is not an exception and cannot be caught. The bound has to sit in front
 * of the allocation rather than around it.
 *
 * Eight million is ~64 MB of live elements: far past any array worth stepping through by hand,
 * and far short of what a tab can be asked to hold.
 */
export const MAX_HEAP_ELEMENTS = 8_000_000;

/**
 * Elements this heap will copy into the history over a whole run.
 *
 * The subtler of the two limits, and the one that actually bites. `freeze()` keeps one
 * immutable copy of every array a step changed (ADR-0001), so the history costs
 * `array length × mutating steps` — not `array length`. Measured: a 10,000-element array
 * written 1,817 times costs 148 MB, and the same program at the 500,000-step ceiling would
 * ask for roughly 3.7 GB. The live-heap bound above never sees it, because no single array is
 * large.
 *
 * Twenty-four million elements is ~192 MB of recorded arrays, which keeps an array-heavy run
 * inside the same order of magnitude as the ~275 MB `workers/run-protocol` already documents
 * as the worst case for a run at that ceiling.
 */
export const MAX_RECORDED_ELEMENTS = 24_000_000;

/** A mutable field of a live instance; `FieldSlot` is the frozen view of one. */
interface FieldCell {
  readonly name: string;
  readonly descriptor: string;
  value: number;
  kind: ValueKind;
}

/**
 * One object on the heap. Arrays and instances share the versioning — every write bumps it,
 * and `freeze()` re-copies only what changed — because that is what keeps the history
 * affordable, and it has nothing to do with which of the two an object is.
 */
type HeapCell =
  | { readonly sort: 'array'; readonly elements: number[]; version: number }
  | {
      readonly sort: 'instance';
      readonly className: string;
      readonly fields: FieldCell[];
      version: number;
    };

interface FrozenCell {
  readonly version: number;
  readonly object: HeapObject;
}

const EMPTY_HEAP: readonly HeapObject[] = Object.freeze([]);

/** JVMS §2.3, §2.4: every field starts at the default value for its type, and `null` is -1. */
function defaultFor(descriptor: string): { value: number; kind: ValueKind } {
  return descriptor.startsWith('L') || descriptor.startsWith('[')
    ? { value: NULL_REFERENCE, kind: 'ref' }
    : { value: 0, kind: 'int' };
}

export class Heap {
  private readonly cells: HeapCell[] = [];
  /** Bumped by every allocation and every store; an untouched heap reuses its frozen view. */
  private revision = 0;
  /** Elements across every array, against `MAX_HEAP_ELEMENTS`. Arrays are never freed. */
  private liveElements = 0;
  /** Elements copied into the history so far, against `MAX_RECORDED_ELEMENTS`. */
  private recordedElements = 0;
  private readonly frozenCells: FrozenCell[] = [];
  /** Revision the view below was taken at; revision 0 is the empty heap of an int-only run. */
  private frozenRevision = 0;
  private frozenHeap: readonly HeapObject[] = EMPTY_HEAP;

  /**
   * JVMS §6.5 new: an instance with every field at its default. The field list comes from the
   * class and is fixed here — a JVM decides an object's shape at allocation, and so does this.
   *
   * A field costs the same budget an array element does; an object graph is as capable of
   * exhausting a tab as a large array is, and the two are counted together.
   */
  allocateInstance(
    className: string,
    fields: readonly { readonly name: string; readonly descriptor: string }[],
  ): number {
    const held = this.liveElements + Math.max(fields.length, 1);
    if (held > MAX_HEAP_ELEMENTS) {
      throw outOfMemory('heap', held, MAX_HEAP_ELEMENTS);
    }
    this.cells.push({
      sort: 'instance',
      className,
      fields: fields.map((field) => ({
        name: field.name,
        descriptor: field.descriptor,
        ...defaultFor(field.descriptor),
      })),
      version: 0,
    });
    this.liveElements = held;
    this.revision += 1;
    return this.cells.length - 1;
  }

  /** JVMS §6.5 getfield. */
  loadField(reference: number, name: string): { value: number; kind: ValueKind } {
    const cell = this.fieldCellAt(reference, name);
    return { value: cell.value, kind: cell.kind };
  }

  /** JVMS §6.5 putfield. */
  storeField(reference: number, name: string, value: number, kind: ValueKind): void {
    const object = this.cellAt(reference);
    const cell = this.fieldCellAt(reference, name);
    cell.value = value;
    cell.kind = kind;
    object.version += 1;
    this.revision += 1;
  }

  /** The class an instance is of, for a virtual call that has to resolve against it. */
  classNameOf(reference: number): string | undefined {
    const cell = this.cellAt(reference);
    return cell.sort === 'instance' ? cell.className : undefined;
  }

  private fieldCellAt(reference: number, name: string): FieldCell {
    const cell = this.cellAt(reference);
    if (cell.sort !== 'instance') {
      throw new VmFault({
        kind: 'invalid-state',
        message: `field ${name} was read through a reference to an array`,
      });
    }
    const field = cell.fields.find((candidate) => candidate.name === name);
    if (field === undefined) {
      throw new VmFault({
        kind: 'invalid-state',
        message: `${cell.className} has no field named ${name}`,
      });
    }
    return field;
  }

  /** JVMS §6.5 newarray: a zero-filled array, and the handle that names it from now on. */
  allocateIntArray(length: number): number {
    if (length < 0) {
      throw new VmFault({ kind: 'negative-array-size', size: length });
    }
    // Checked before allocating, not after: `new Array(n).fill(0)` for a large enough `n` ends
    // the process rather than throwing, so there is nothing to recover from afterwards.
    const held = this.liveElements + length;
    if (held > MAX_HEAP_ELEMENTS) {
      throw outOfMemory('heap', held, MAX_HEAP_ELEMENTS);
    }
    this.cells.push({ sort: 'array', elements: new Array<number>(length).fill(0), version: 0 });
    this.liveElements = held;
    this.revision += 1;
    return this.cells.length - 1;
  }

  /** JVMS §6.5 arraylength. */
  lengthOf(reference: number): number {
    return this.arrayCellAt(reference).elements.length;
  }

  /** JVMS §6.5 iaload. */
  loadInt(reference: number, index: number): number {
    const { elements } = this.arrayCellAt(reference);
    const value = elements[index];
    if (value === undefined) {
      throw outOfBounds(index, elements.length);
    }
    return value;
  }

  /** JVMS §6.5 iastore. */
  storeInt(reference: number, index: number, value: number): void {
    const cell = this.arrayCellAt(reference);
    // Writing past the end would silently grow the JS array into something no longer an int[n].
    if (index < 0 || index >= cell.elements.length) {
      throw outOfBounds(index, cell.elements.length);
    }
    cell.elements[index] = value;
    cell.version += 1;
    this.revision += 1;
  }

  /** An array instruction reached an instance: a state the verifier rejects (JVMS §4.10). */
  private arrayCellAt(reference: number): Extract<HeapCell, { sort: 'array' }> {
    const cell = this.cellAt(reference);
    if (cell.sort !== 'array') {
      throw new VmFault({
        kind: 'invalid-state',
        message: `an array instruction was applied to an instance of ${cell.className}`,
      });
    }
    return cell;
  }

  /**
   * Frozen view for a snapshot.
   *
   * A step that touched no array hands back the very array it handed back last time, and a
   * step that wrote to one array keeps the frozen objects of all the others. The history
   * therefore costs one element copy per allocation and per mutating step, not one per step
   * per array — the same reasoning that keeps the call stack from being copied every step.
   */
  freeze(): readonly HeapObject[] {
    if (this.revision === this.frozenRevision) {
      return this.frozenHeap;
    }
    this.frozenHeap = Object.freeze(
      this.cells.map((cell, handle) => this.freezeCell(handle, cell)),
    );
    this.frozenRevision = this.revision;
    return this.frozenHeap;
  }

  private freezeCell(handle: number, cell: HeapCell): HeapObject {
    const previous = this.frozenCells[handle];
    if (previous?.version === cell.version) {
      return previous.object;
    }

    // A copy is about to be made and kept for as long as the history is: this is the one
    // place that knows what recording this run has really cost so far. A field costs what an
    // element costs, so an object graph is metered on the same budget as a large array.
    const size = cell.sort === 'array' ? cell.elements.length : cell.fields.length;
    const recorded = this.recordedElements + size;
    if (recorded > MAX_RECORDED_ELEMENTS) {
      throw outOfMemory('history', recorded, MAX_RECORDED_ELEMENTS);
    }
    this.recordedElements = recorded;

    const object: HeapObject =
      cell.sort === 'array'
        ? Object.freeze({
            kind: 'int-array' as const,
            length: cell.elements.length,
            elements: Object.freeze([...cell.elements]),
          })
        : Object.freeze({
            kind: 'instance' as const,
            className: cell.className,
            fields: Object.freeze(
              cell.fields.map((field) =>
                Object.freeze({
                  name: field.name,
                  descriptor: field.descriptor,
                  value: field.value,
                  kind: field.kind,
                }),
              ),
            ),
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

function outOfMemory(resource: 'heap' | 'history', requested: number, limit: number): VmFault {
  return new VmFault({ kind: 'out-of-memory', resource, requested, limit });
}
