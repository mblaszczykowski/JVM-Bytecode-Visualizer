import { VmFault } from './errors';
import type { HeapObject, ValueKind } from './types';

export const NULL_REFERENCE = -1;

export const MAX_HEAP_ELEMENTS = 8_000_000;

export const MAX_RECORDED_ELEMENTS = 24_000_000;

interface FieldCell {
  readonly name: string;
  readonly descriptor: string;
  value: number;
  kind: ValueKind;
}

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

function defaultFor(descriptor: string): { value: number; kind: ValueKind } {
  return descriptor.startsWith('L') || descriptor.startsWith('[')
    ? { value: NULL_REFERENCE, kind: 'ref' }
    : { value: 0, kind: 'int' };
}

export class Heap {
  private readonly cells: HeapCell[] = [];
  private revision = 0;
  private liveElements = 0;
  private recordedElements = 0;
  private readonly frozenCells: FrozenCell[] = [];
  private frozenRevision = 0;
  private frozenHeap: readonly HeapObject[] = EMPTY_HEAP;

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

  loadField(reference: number, name: string): { value: number; kind: ValueKind } {
    const cell = this.fieldCellAt(reference, name);
    return { value: cell.value, kind: cell.kind };
  }

  storeField(reference: number, name: string, value: number, kind: ValueKind): void {
    const object = this.cellAt(reference);
    const cell = this.fieldCellAt(reference, name);
    cell.value = value;
    cell.kind = kind;
    object.version += 1;
    this.revision += 1;
  }

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

  allocateIntArray(length: number): number {
    if (length < 0) {
      throw new VmFault({ kind: 'negative-array-size', size: length });
    }
    const held = this.liveElements + length;
    if (held > MAX_HEAP_ELEMENTS) {
      throw outOfMemory('heap', held, MAX_HEAP_ELEMENTS);
    }
    this.cells.push({ sort: 'array', elements: new Array<number>(length).fill(0), version: 0 });
    this.liveElements = held;
    this.revision += 1;
    return this.cells.length - 1;
  }

  lengthOf(reference: number): number {
    return this.arrayCellAt(reference).elements.length;
  }

  loadInt(reference: number, index: number): number {
    const { elements } = this.arrayCellAt(reference);
    const value = elements[index];
    if (value === undefined) {
      throw outOfBounds(index, elements.length);
    }
    return value;
  }

  storeInt(reference: number, index: number, value: number): void {
    const cell = this.arrayCellAt(reference);
    if (index < 0 || index >= cell.elements.length) {
      throw outOfBounds(index, cell.elements.length);
    }
    cell.elements[index] = value;
    cell.version += 1;
    this.revision += 1;
  }

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
