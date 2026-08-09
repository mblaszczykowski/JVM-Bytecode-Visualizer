import { describe, expect, it, vi } from 'vitest';

import { parseClassFile, type ClassFile } from '../core/classfile';
import { execute, type ExecutionResult, type Snapshot } from '../core/interpreter';
import {
  SNAPSHOTS_PER_MESSAGE,
  withHistory,
  type RunCommand,
  type RunEvent,
} from '../workers/run-protocol';

import { readExampleBytes } from './__fixtures__/example-files';
import {
  createProgramRunner,
  inlineRunner,
  isRunCancelled,
  RunCancelled,
  workerRunner,
  type RunWorker,
} from './program-runner';

function gcd(): ClassFile {
  return parseClassFile(readExampleBytes('Gcd.class'));
}

function commandFor(classFile: ClassFile, maxSteps = 20_000): RunCommand {
  return { classFile, entryMethod: 'main', maxSteps };
}

class FakeWorker implements RunWorker {
  onmessage: ((event: MessageEvent<RunEvent>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly commands: RunCommand[] = [];
  terminations = 0;

  postMessage(command: RunCommand): void {
    this.commands.push(command);
  }

  terminate(): void {
    this.terminations += 1;
  }

  emit(event: RunEvent): void {
    this.onmessage?.(new MessageEvent('message', { data: event }));
  }

  stream(result: ExecutionResult): void {
    for (let from = 0; from < result.snapshots.length; from += SNAPSHOTS_PER_MESSAGE) {
      this.emit({
        kind: 'snapshots',
        snapshots: result.snapshots.slice(from, from + SNAPSHOTS_PER_MESSAGE),
      });
    }
    this.emit({ kind: 'done', result: withHistory(result, []) });
  }

  fail(): void {
    this.onerror?.(new ErrorEvent('error'));
  }
}

function fakeHistory(steps: number): readonly Snapshot[] {
  return Array.from({ length: steps }, (_, step) => ({ step, callStack: [] }));
}

describe('running on this thread', () => {
  it('produces exactly what the interpreter produces, and admits it cannot be stopped', async () => {
    const classFile = gcd();

    const result = await inlineRunner.run(commandFor(classFile));

    expect(inlineRunner.cancellable).toBe(false);
    expect(result).toEqual(execute(classFile, { entryMethod: 'main', maxSteps: 20_000 }));
  });

  it('refuses a run the reader had already given up on before it began', async () => {
    await expect(
      inlineRunner.run(commandFor(gcd()), { signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(RunCancelled);
  });
});

describe('running in a worker', () => {
  it('reassembles the streamed batches into the history the interpreter produced', async () => {
    const classFile = gcd();
    const expected = execute(classFile, { entryMethod: 'main', maxSteps: 20_000 });
    const worker = new FakeWorker();
    const runner = workerRunner(() => worker);

    const pending = runner.run(commandFor(classFile));
    worker.stream(expected);

    expect(runner.cancellable).toBe(true);
    expect(await pending).toEqual(expected);
    expect(worker.commands).toEqual([commandFor(classFile)]);
    expect(worker.terminations).toBe(1);
  });

  it('says how far the handover has got, without a report per batch', async () => {
    const worker = new FakeWorker();
    const runner = workerRunner(() => worker);
    const onProgress = vi.fn<(steps: number) => void>();

    const pending = runner.run(commandFor(gcd()), { onProgress });
    worker.stream({ kind: 'step-limit', limit: 60_000, snapshots: fakeHistory(60_000) });
    await pending;

    expect(onProgress.mock.calls.flat()).toEqual([26_000, 52_000]);
  });

  it('ends the run when the reader gives up, rather than only ignoring it', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const runner = workerRunner(() => worker);

    const pending = runner.run(commandFor(gcd()), { signal: controller.signal });
    worker.emit({ kind: 'snapshots', snapshots: fakeHistory(10) });
    controller.abort();

    await expect(pending).rejects.toSatisfy(isRunCancelled);
    expect(worker.terminations).toBe(1);
  });

  it('gives up on a worker that has gone silent, instead of waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const runner = workerRunner(() => worker, inlineRunner, 1_000);

      const pending = runner.run(commandFor(gcd()));
      const settled = expect(pending).rejects.toThrow('stopped answering');
      await vi.advanceTimersByTimeAsync(1_000);
      await settled;

      expect(worker.terminations).toBe(1);
      expect(runner.cancellable).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps waiting as long as the worker is still streaming', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const runner = workerRunner(() => worker, inlineRunner, 1_000);

      const pending = runner.run(commandFor(gcd()));
      for (let batch = 0; batch < 3; batch += 1) {
        await vi.advanceTimersByTimeAsync(900);
        worker.emit({ kind: 'snapshots', snapshots: fakeHistory(10) });
      }
      worker.emit({ kind: 'done', result: { kind: 'completed' } });

      expect((await pending).snapshots).toHaveLength(30);
      expect(runner.cancellable).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an interpreter that threw as a failure of this run', async () => {
    const worker = new FakeWorker();
    const runner = workerRunner(() => worker);

    const pending = runner.run(commandFor(gcd()));
    worker.emit({ kind: 'failed', reason: 'the class file fell apart' });

    await expect(pending).rejects.toThrow('the class file fell apart');
    expect(worker.terminations).toBe(1);
  });
});

describe('when there is no usable worker', () => {
  it('runs the program here instead of failing the load', async () => {
    const classFile = gcd();
    const worker = new FakeWorker();
    const runner = workerRunner(() => worker);

    const pending = runner.run(commandFor(classFile));
    worker.fail();

    expect(await pending).toEqual(execute(classFile, { entryMethod: 'main', maxSteps: 20_000 }));
  });

  it('stops offering to cancel once a worker has failed to load', async () => {
    const worker = new FakeWorker();
    let spawns = 0;
    const runner = workerRunner(() => {
      spawns += 1;
      return worker;
    });

    const first = runner.run(commandFor(gcd()));
    worker.fail();
    await first;
    await runner.run(commandFor(gcd()));

    expect(runner.cancellable).toBe(false);
    expect(spawns).toBe(1);
  });

  it('runs the program here when spawning throws outright', async () => {
    const classFile = gcd();
    const runner = workerRunner((): RunWorker => {
      throw new Error('module workers are not supported');
    });

    const result = await runner.run(commandFor(classFile));

    expect(runner.cancellable).toBe(false);
    expect(result).toEqual(execute(classFile, { entryMethod: 'main', maxSteps: 20_000 }));
  });

  it('is what the application falls back to where `Worker` does not exist at all', () => {
    expect(globalThis).not.toHaveProperty('Worker');
    expect(createProgramRunner()).toBe(inlineRunner);
  });
});
