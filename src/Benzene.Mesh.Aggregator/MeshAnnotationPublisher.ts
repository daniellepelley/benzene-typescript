/** Port of Benzene.Mesh.Aggregator.MeshAnnotationPublisher. */
import { randomUUID } from 'node:crypto';
import { MeshAnnotation, MeshAnnotationLog, MeshAnnotationThread } from '@benzene/mesh-contracts';
import { IMeshArtifactStore } from './IMeshArtifactStore';

const ArtifactPath = 'annotations.json';

/**
 * Appends discussion notes to the `annotations.json` artifact - the write half of the mesh discussion
 * feature. The read half is the artifact itself: it lives in the same `IMeshArtifactStore` as
 * `manifest.json`, so any static host serves recorded discussion with zero backend, and only posting a new
 * note needs this publisher's handler (`MeshAnnotationsMessageHandler`) running somewhere.
 *
 * Read-modify-write of the log is serialized per process with an async mutex (C#'s `SemaphoreSlim(1, 1)`
 * -> a promise-chain lock; the single-threaded event loop still interleaves `await`s, so the lock is
 * genuinely needed to stop two concurrent `addAsync` calls racing the read-modify-write). Concurrent
 * writers in separate hosts are out of scope. An unparseable existing log starts fresh rather than failing
 * - but never silently: the previous content is preserved to a timestamped sibling artifact first.
 * `Guid.NewGuid().ToString("n")` -> `randomUUID()` with dashes stripped; `DateTimeOffset` -> epoch ms.
 */
export class MeshAnnotationPublisher {
  private readonly clock: () => number;
  private readonly ids: () => string;
  private writeLock: Promise<void> = Promise.resolve();

  /**
   * @param store The artifact store the log lives in - the same one the aggregator publishes to.
   * @param clock Supplies the current time (epoch ms); defaults to `Date.now`. Overridable for deterministic tests.
   * @param ids Supplies new annotation ids; defaults to a dashless UUID. Overridable for deterministic tests.
   */
  constructor(private readonly store: IMeshArtifactStore, clock?: () => number, ids?: () => string) {
    this.clock = clock ?? (() => Date.now());
    this.ids = ids ?? (() => randomUUID().replace(/-/g, ''));
  }

  /**
   * Appends one note to the log and republishes `annotations.json`, returning the annotated entity's full
   * thread (oldest first) so a caller can render the discussion it just posted into. Inputs are assumed
   * already validated (the handler's job).
   */
  async addAsync(entity: string, author: string, text: string): Promise<MeshAnnotationThread> {
    return this.withLock(async () => {
      const existing = await this.readLogAsync();
      const annotation = new MeshAnnotation(this.ids(), entity, author, text, this.clock());
      const annotations = [...existing, annotation];

      await this.store.publishAsync(
        ArtifactPath,
        JSON.stringify(new MeshAnnotationLog(this.clock(), annotations), null, 2),
      );

      return new MeshAnnotationThread(
        entity,
        annotations.filter((a) => a.entity === entity).sort((a, b) => a.createdAtUtc - b.createdAtUtc),
      );
    });
  }

  /** Serializes read-modify-write against concurrent `addAsync` calls (the `SemaphoreSlim` port). */
  private withLock<T>(action: () => Promise<T>): Promise<T> {
    const run = this.writeLock.then(action, action);
    // Keep the chain alive but swallow errors so one failed write doesn't poison the lock for the next.
    this.writeLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async readLogAsync(): Promise<MeshAnnotation[]> {
    let json: string | undefined;
    try {
      json = await this.store.tryReadAsync(ArtifactPath);
      if (json === undefined) {
        return [];
      }
      const log = JSON.parse(json) as { annotations?: MeshAnnotation[] } | null;
      return log?.annotations ?? [];
    } catch {
      // A corrupt log must not brick discussion forever - but user-authored notes are the one artifact
      // that can't be regenerated from the fleet, so park the unreadable content aside (best-effort)
      // instead of overwriting it.
      if (json !== undefined) {
        try {
          await this.store.publishAsync(`annotations.unreadable-${Math.floor(this.clock() / 1000)}.json`, json);
        } catch {
          // Preserving the corrupt log is best-effort only.
        }
      }
      return [];
    }
  }
}
