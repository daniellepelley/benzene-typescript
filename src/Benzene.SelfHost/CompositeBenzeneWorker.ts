import { IBenzeneWorker } from '@benzene/abstractions-middleware';

/**
 * Aggregates several {@link IBenzeneWorker}s as one, starting and stopping them together.
 * Port of Benzene.SelfHost.CompositeBenzeneWorker.
 */
export class CompositeBenzeneWorker implements IBenzeneWorker {
  private readonly workers: readonly IBenzeneWorker[];

  constructor(workers: Iterable<IBenzeneWorker>) {
    // Materialize once. Callers pass a deferred sequence (BenzeneWorkerBuilder.create hands us
    // `apps.map(factory => factory(resolver))`, and every factory news up a fresh worker), so
    // re-enumerating in stopAsync would build a SECOND, never-started worker set and stop those
    // instead - silently skipping every worker's drain/close/commit. `[...workers]` snapshots it.
    this.workers = [...workers];
  }

  async startAsync(cancellationToken?: AbortSignal): Promise<void> {
    await Promise.all(this.workers.map((x) => x.startAsync(cancellationToken)));
  }

  async stopAsync(cancellationToken?: AbortSignal): Promise<void> {
    await Promise.all(this.workers.map((x) => x.stopAsync(cancellationToken)));
  }
}
