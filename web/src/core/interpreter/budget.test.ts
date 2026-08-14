import { describe, expect, it } from 'vitest';

import { AccessFlag, type CodeAttribute } from '../classfile';
import { expectVmError } from './__fixtures__/expect-execution';
import {
  ConstantPoolBuilder,
  syntheticClass,
  SYNTHETIC_CLASS_NAME,
} from './__fixtures__/synthetic-class';
import { MAX_RECORDED_ELEMENTS, RecordingBudget } from './budget';
import { ConsoleOutput } from './console';
import { isVmFault, type VmFault } from './errors';
import { ExternalPool, stringConstant } from './externals';
import { createFrame, prepareMethod, push, type Frame } from './frame';
import { Heap } from './heap';
import { execute } from './interpreter';
import { SnapshotWriter, type MachineState } from './snapshot';
import type { VmFaultDetail } from './types';

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

function faultFrom(charge: () => void): VmFaultDetail {
  try {
    charge();
  } catch (error) {
    if (!isVmFault(error)) {
      throw error;
    }
    return error.detail;
  }
  throw new Error('the budget accepted a charge it should have refused');
}

interface FrameRecorder {
  readonly frame: Frame;
  readonly record: (step: number) => void;
}

function recorderOver(budget: RecordingBudget, maxLocals: number): FrameRecorder {
  const code: CodeAttribute = { maxStack: 2, maxLocals, code: Uint8Array.from([0x00, 0xb1]) };
  const prepared = prepareMethod(
    { name: 'main', descriptor: '()V', accessFlags: AccessFlag.Static, code },
    code,
  );
  const instruction = prepared.flow.get(0)?.instruction;
  if (instruction === undefined) {
    throw new Error('the prepared method decoded no instruction at pc 0');
  }

  const writer = new SnapshotWriter(budget);
  const state: MachineState = {
    heap: new Heap(budget),
    console: new ConsoleOutput(budget),
    externals: new ExternalPool(budget),
  };
  const frame = createFrame(prepared, [], { step: 0 });

  return {
    frame,
    record: (step) => {
      writer.next(step, [frame], state, instruction, undefined);
    },
  };
}

function u2(value: number): readonly number[] {
  return [(value >> 8) & 0xff, value & 0xff];
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

  it('charges nothing for a write that appends no text', () => {
    const output = new ConsoleOutput(new RecordingBudget(1));
    output.writeLine('one');
    const frozen = output.freeze();

    output.write('');

    expect(output.freeze()).toBe(frozen);
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

describe('the frame history charging to the budget', () => {
  it('charges three slots for every local a copied frame retains', () => {
    const recorder = recorderOver(new RecordingBudget(1), 3);

    expect(
      faultFrom(() => {
        recorder.record(0);
      }),
    ).toEqual({
      kind: 'out-of-memory',
      resource: 'history',
      requested: 10,
      limit: 1,
    });
  });

  it('charges one slot for a call stack whose frame it reuses, and three per operand', () => {
    const recorder = recorderOver(new RecordingBudget(22), 3);

    recorder.record(0);
    recorder.record(1);
    push(recorder.frame, 7, 'int');

    expect(
      faultFrom(() => {
        recorder.record(2);
      }),
    ).toEqual({
      kind: 'out-of-memory',
      resource: 'history',
      requested: 24,
      limit: 22,
    });
  });

  it('stops a run whose frames are too wide to record', () => {
    const result = execute(
      syntheticClass({
        methods: [
          { name: 'main', descriptor: '()V', maxLocals: 3_000, code: [0x00, 0xa7, 0xff, 0xff] },
        ],
      }),
      { maxSteps: 30_000 },
    );

    expect(expectVmError(result)).toMatchObject({
      kind: 'out-of-memory',
      resource: 'history',
      limit: MAX_RECORDED_ELEMENTS,
      methodName: 'main',
    });
    expect(result.snapshots).toHaveLength(2_666);
  });

  it('stops a run whose call stack is too deep to record', () => {
    const pool = new ConstantPoolBuilder();
    const down = pool.methodref(SYNTHETIC_CLASS_NAME, 'down', '(I)I');
    const result = execute(
      syntheticClass({
        pool,
        methods: [
          { name: 'main', descriptor: '()I', code: [0x11, ...u2(1_400), 0xb8, ...u2(down), 0xac] },
          {
            name: 'down',
            descriptor: '(I)I',
            maxLocals: 2,
            code: [
              ...[0x1a, 0x9d, ...u2(7)],
              ...[0x00, 0xa7, 0xff, 0xff],
              ...[0x1a, 0x04, 0x64, 0xb8, ...u2(down), 0xac],
            ],
          },
        ],
      }),
      { maxSteps: 30_000 },
    );

    expect(expectVmError(result)).toMatchObject({
      kind: 'out-of-memory',
      resource: 'history',
      limit: MAX_RECORDED_ELEMENTS,
      methodName: 'down',
    });
    expect(result.snapshots).toHaveLength(21_205);
  });
});
