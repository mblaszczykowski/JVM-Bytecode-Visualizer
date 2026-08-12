import { describe, expect, it } from 'vitest';

import { RecordingBudget } from './budget';
import { ConsoleOutput } from './console';
import { isVmFault, type VmFault } from './errors';
import { ExternalPool, stringConstant } from './externals';
import { Heap } from './heap';

function chargesUntilItStops(freeze: () => unknown): VmFault {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      freeze();
    } catch (error) {
      if (!isVmFault(error)) {
        throw error;
      }
      return error;
    }
  }
  throw new Error('the budget never stopped the recording');
}

describe('RecordingBudget', () => {
  it('names the history as the resource that ran out', () => {
    const budget = new RecordingBudget(4);

    budget.charge(4);
    const fault = chargesUntilItStops(() => {
      budget.charge(1);
    });

    expect(fault.detail).toEqual({
      kind: 'out-of-memory',
      resource: 'history',
      requested: 5,
      limit: 4,
    });
  });
});

describe('the heap charging to the budget', () => {
  it('charges the handles the frozen heap retains, not only the cells that changed', () => {
    const budget = new RecordingBudget(22);
    const heap = new Heap(budget);
    for (let cell = 0; cell < 5; cell += 1) {
      heap.allocateIntArray(1);
    }

    heap.freeze();
    heap.storeInt(0, 0, 7);
    heap.freeze();
    heap.storeInt(0, 0, 8);
    heap.freeze();

    heap.storeInt(0, 0, 9);
    expect(chargesUntilItStops(() => heap.freeze()).detail).toMatchObject({
      kind: 'out-of-memory',
      resource: 'history',
      requested: 27,
    });
  });

  it('charges nothing for a step that wrote to no object', () => {
    const budget = new RecordingBudget(2);
    const heap = new Heap(budget);
    heap.allocateIntArray(1);

    const frozen = heap.freeze();

    expect(heap.freeze()).toBe(frozen);
    expect(heap.freeze()).toBe(frozen);
  });
});

describe('the console charging to the budget', () => {
  it('charges every line the snapshot retains', () => {
    const output = new ConsoleOutput(new RecordingBudget(6));

    output.writeLine('one');
    output.freeze();
    output.writeLine('two');
    output.freeze();
    output.writeLine('three');
    output.freeze();

    output.writeLine('four');
    expect(chargesUntilItStops(() => output.freeze()).detail).toMatchObject({
      kind: 'out-of-memory',
      resource: 'history',
      requested: 10,
    });
  });

  it('hands back the same lines, uncharged, while nothing is printed', () => {
    const output = new ConsoleOutput(new RecordingBudget(3));
    output.writeLine('one');

    const frozen = output.freeze();

    expect(output.freeze()).toBe(frozen);
    expect(output.freeze()).toBe(frozen);
    expect(frozen).toEqual(['one']);
  });
});

describe('the external pool charging to the budget', () => {
  it('charges every value the snapshot retains', () => {
    const pool = new ExternalPool(new RecordingBudget(3));

    pool.intern(stringConstant('one'));
    pool.freeze();
    pool.intern(stringConstant('two'));
    pool.freeze();

    pool.intern(stringConstant('three'));
    expect(chargesUntilItStops(() => pool.freeze()).detail).toMatchObject({
      kind: 'out-of-memory',
      resource: 'history',
      requested: 6,
    });
  });

  it('hands back the same values, uncharged, while nothing is interned', () => {
    const pool = new ExternalPool(new RecordingBudget(2));
    pool.intern(stringConstant('one'));

    const frozen = pool.freeze();

    expect(pool.freeze()).toBe(frozen);
    expect(pool.intern(stringConstant('one'))).toBe(0);
    expect(pool.freeze()).toBe(frozen);
  });
});
