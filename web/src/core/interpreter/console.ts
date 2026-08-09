const EMPTY_OUTPUT: readonly string[] = Object.freeze([]);

export class ConsoleOutput {
  private readonly completed: string[] = [];
  private open: string | undefined;
  private revision = 0;
  private frozenRevision = 0;
  private frozen: readonly string[] = EMPTY_OUTPUT;

  write(text: string): void {
    const parts = text.split('\n');
    const last = parts.length - 1;
    for (const [index, part] of parts.entries()) {
      if (index < last) {
        this.completed.push((this.open ?? '') + part);
        this.open = undefined;
      } else if (part !== '' || this.open !== undefined) {
        this.open = (this.open ?? '') + part;
      }
    }
    this.revision += 1;
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
    this.frozen = Object.freeze(
      this.open === undefined ? [...this.completed] : [...this.completed, this.open],
    );
    this.frozenRevision = this.revision;
    return this.frozen;
  }
}
