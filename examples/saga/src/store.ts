/**
 * A trivial in-memory record store, so the example can show that a rolled-back saga leaves nothing
 * behind. A stage's steps run concurrently, but JavaScript is single-threaded, so no lock is needed (the
 * .NET original guards a shared list with a lock). Port of the .NET `Store`.
 */
export class Store {
  private readonly records: string[] = [];

  add(kind: string, id: string): void {
    this.records.push(`${kind}:${id}`);
  }

  remove(kind: string, id: string): void {
    const index = this.records.indexOf(`${kind}:${id}`);
    if (index >= 0) {
      this.records.splice(index, 1);
    }
  }

  snapshot(): readonly string[] {
    return [...this.records];
  }
}
