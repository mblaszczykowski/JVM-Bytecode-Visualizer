import type { RecordingBudget } from './budget';
import { VmFault } from './errors';
import { narrowInt } from './int32';
import type { HeapObject, ValueKind } from './types';

export const NULL_REFERENCE = -1;

export const MAX_HEAP_ELEMENTS = 8_000_000;

interface FieldCell {
  readonly name: string;
  readonly descriptor: string;
  value: number;
  kind: ValueKind;
}

interface InstanceCell {
  readonly sort: 'instance';
  readonly className: string;
  readonly fields: FieldCell[];
  version: number;
}

interface ArrayCell {
  readonly sort: 'array';
  readonly elements: number[];
  version: number;
}

type HeapCell = ArrayCell | InstanceCell;

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
  private readonly budget: RecordingBudget;
  private readonly cells: HeapCell[] = [];
  private revision = 0;
  private liveElements = 0;
  private readonly frozenCells: FrozenCell[] = [];
  private frozenRevision = 0;
  private frozenHeap: readonly HeapObject[] = EMPTY_HEAP;

  constructor(budget: RecordingBudget) {
    this.budget = budget;
  }

  allocateInstance(
    className: string,
    fields: readonly { readonly name: string; readonly descriptor: string }[],
  ): number {
    const held = this.liveElements + Math.max(fields.length, 1);
    if (held > MAX_HEAP_ELEMENTS) {
      throw outOfMemory(held, MAX_HEAP_ELEMENTS);
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

  loadField(
    reference: number,
    name: string,
    descriptor: string,
  ): { value: number; kind: ValueKind } {
    const field = this.fieldIn(this.instanceCellAt(reference, name), name, descriptor);
    return { value: field.value, kind: field.kind };
  }

  storeField(
    reference: number,
    name: string,
    descriptor: string,
    value: number,
    kind: ValueKind,
  ): void {
    const cell = this.instanceCellAt(reference, name);
    const field = this.fieldIn(cell, name, descriptor);
    const referenceField = descriptor.startsWith('L') || descriptor.startsWith('[');
    if ((kind === 'int') === referenceField) {
      throw new VmFault({
        kind: 'invalid-state',
        message: `field ${name} of type ${descriptor} cannot hold ${kind === 'int' ? 'an int' : 'a reference'}`,
      });
    }
    field.value = narrowInt(value, descriptor);
    field.kind = kind;
    cell.version += 1;
    this.revision += 1;
  }

  private instanceCellAt(reference: number, name: string): InstanceCell {
    const cell = this.cellAt(reference);
    if (cell.sort !== 'instance') {
      throw new VmFault({
        kind: 'invalid-state',
        message: `field ${name} was reached through a reference to an array`,
      });
    }
    return cell;
  }

  private fieldIn(cell: InstanceCell, name: string, descriptor: string): FieldCell {
    const field = cell.fields.find(
      (candidate) => candidate.name === name && candidate.descriptor === descriptor,
    );
    if (field === undefined) {
      throw new VmFault({
        kind: 'invalid-state',
        message: `${cell.className} has no field ${name} of type ${descriptor}`,
      });
    }
    return field;
  }

  allocateIntArray(length: number): number {
    if (length < 0) {
      throw new VmFault({ kind: 'negative-array-size', size: length });
    }
    const held = this.liveElements + Math.max(length, 1);
    if (held > MAX_HEAP_ELEMENTS) {
      throw outOfMemory(held, MAX_HEAP_ELEMENTS);
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

  private arrayCellAt(reference: number): ArrayCell {
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
    this.budget.charge(this.cells.length);
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
    this.budget.charge(cell.sort === 'array' ? cell.elements.length : cell.fields.length);

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

function outOfMemory(requested: number, limit: number): VmFault {
  return new VmFault({ kind: 'out-of-memory', resource: 'heap', requested, limit });
}
