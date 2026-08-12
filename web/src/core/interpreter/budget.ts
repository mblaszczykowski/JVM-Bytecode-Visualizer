import { VmFault } from './errors';

export const MAX_RECORDED_ELEMENTS = 24_000_000;

export class RecordingBudget {
  private readonly limit: number;
  private recorded = 0;

  constructor(limit: number = MAX_RECORDED_ELEMENTS) {
    this.limit = limit;
  }

  charge(elements: number): void {
    const recorded = this.recorded + elements;
    if (recorded > this.limit) {
      throw new VmFault({
        kind: 'out-of-memory',
        resource: 'history',
        requested: recorded,
        limit: this.limit,
      });
    }
    this.recorded = recorded;
  }
}
