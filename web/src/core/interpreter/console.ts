/**
 * What the running program has printed so far.
 *
 * `print` and `println` are two halves of the same operation: a line stays open until
 * something terminates it, so `print("a"); print("b"); println("c")` is one line and not
 * three. The text is kept as the lines a reader sees — a line that has been terminated is
 * complete, and at most one line is still open — rather than as a single string every
 * consumer would have to split the same way.
 *
 * Mutable during execution; `freeze()` produces the immutable view a snapshot carries. Steps
 * that print nothing hand back the very array the previous snapshot got, the way `Heap.freeze`
 * and the frozen call stack frames are shared, and almost every step of a run prints nothing.
 */

const EMPTY_OUTPUT: readonly string[] = Object.freeze([]);

export class ConsoleOutput {
  private readonly completed: string[] = [];
  /** The line still waiting for its terminator; `undefined` when the cursor is at column 0. */
  private open: string | undefined;
  /** Bumped by every write; an unchanged console reuses the view below. */
  private revision = 0;
  private frozenRevision = 0;
  private frozen: readonly string[] = EMPTY_OUTPUT;

  /** `PrintStream.print`: appends to the open line, opening one if there is none. */
  write(text: string): void {
    // A printed string may itself contain line terminators, and each of them closes a line.
    const parts = text.split('\n');
    const last = parts.length - 1;
    for (const [index, part] of parts.entries()) {
      if (index < last) {
        this.completed.push((this.open ?? '') + part);
        this.open = undefined;
      } else if (part !== '' || this.open !== undefined) {
        // A terminator with nothing after it leaves no line open — the console is simply at
        // the start of the next one, which nothing has written to yet.
        this.open = (this.open ?? '') + part;
      }
    }
    this.revision += 1;
  }

  /** `PrintStream.println`: writes the text, then terminates the line. */
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
