import type { RecordingBudget } from './budget';

const EMPTY_OUTPUT: readonly string[] = Object.freeze([]);

export class ConsoleOutput {
  private readonly budget: RecordingBudget;
  private readonly completed: string[] = [];
  private open: string | undefined;
  private revision = 0;
  private frozenRevision = 0;
  private frozen: readonly string[] = EMPTY_OUTPUT;

  constructor(budget: RecordingBudget) {
    this.budget = budget;
  }

  write(text: string): void {
    if (text !== '') {
      this.budget.charge((this.open?.length ?? 0) + text.length);
    }
    const parts = text.split('\n');
    const last = parts.length - 1;
    for (const [index, part] of parts.entries()) {
      if (index < last) {
        this.completed.push((this.open ?? '') + part);
        this.open = undefined;
        this.revision += 1;
      } else if (part !== '') {
        this.open = (this.open ?? '') + part;
        this.revision += 1;
      }
    }
  }

  writeLine(text: string): void {
    this.write(text);
    this.completed.push(this.open ?? '');
    this.open = undefined;
    this.revision += 1;
  }

  freeze(): readonly string[] {
    if (this.revision === this.frozenRevision) {
      return this.frozen;
    }
    const lines = this.open === undefined ? [...this.completed] : [...this.completed, this.open];
    this.budget.charge(lines.length);
    this.frozen = Object.freeze(lines);
    this.frozenRevision = this.revision;
    return this.frozen;
  }
}
