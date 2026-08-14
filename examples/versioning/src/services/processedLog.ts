import { serviceToken } from '@benzenejs/abstractions';

/**
 * A tiny in-memory record of what each handler actually received, so the component test can assert which
 * version handler ran (Mechanism A) or what shape the casting pipeline delivered (Mechanism B). The real
 * deployable would write to a data store instead; this is the example's stand-in.
 *
 * Follows the port's convention for anything resolved from the container: the interface keeps the `I`
 * prefix and declares a merged `ServiceToken` constant of the same name.
 */
export interface IProcessedLog {
  record(entry: string): void;
  readonly entries: readonly string[];
}

export const IProcessedLog = serviceToken<IProcessedLog>('IProcessedLog');

export class InMemoryProcessedLog implements IProcessedLog {
  private readonly log: string[] = [];

  record(entry: string): void {
    this.log.push(entry);
  }

  get entries(): readonly string[] {
    return this.log;
  }

  clear(): void {
    this.log.length = 0;
  }
}
