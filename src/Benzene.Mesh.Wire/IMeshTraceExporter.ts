/** Port of Benzene.Mesh.Wire.IMeshTraceExporter (and HttpMeshTraceExporter). */
import { MeshJson } from './MeshJson';
import { MeshTopics } from './MeshTopics';
import { MeshTraceBatch, MeshTraceEvent } from './MeshTraceEvent';

/**
 * Receives every trace event the mesh trace middleware produces. Implementations MUST be
 * non-blocking and lossy under backpressure (docs/specification/mesh.md §4's sender rules): no mesh
 * feed may ever fail, slow, or block the invocation it observed - the middleware additionally
 * shields the invocation from a throwing exporter.
 */
export interface IMeshTraceExporter {
  export(traceEvent: MeshTraceEvent): void;
}

/** A `fetch`-like function - the port of C# `HttpClient.PostAsync` (`HttpClient` -> injectable `fetch`). */
export type TraceFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Batches trace events and POSTs them to a mesh collector's wire-envelope endpoint as `mesh:traces`
 * messages, from a single background flush loop. Lossy by design in every failure mode, per spec §4:
 * a full buffer drops the new event, a failed send drops the batch, and `disposeAsync` flushes the
 * tail so shutdown doesn't lose it. Works against any envelope-speaking collector.
 *
 * Adaptation of the C# original: .NET's `System.Threading.Channels` bounded channel + background
 * `Task` pump has no Node built-in equivalent, so it maps to a bounded array buffer (drop-on-full)
 * drained by a single re-entrancy-guarded async loop, kicked both on reaching `batchSize` and by a
 * periodic `setInterval` (the timer is `unref`'d so it never keeps the process alive). JavaScript
 * has no way to block a thread on a promise, so the C# synchronous `Dispose` bridge becomes a
 * fire-and-forget `dispose()`; prefer `disposeAsync()` where the tail flush must complete.
 */
export class HttpMeshTraceExporter implements IMeshTraceExporter {
  private readonly buffer: MeshTraceEvent[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private draining = false;
  private disposed = false;

  constructor(
    private readonly fetchFn: TraceFetch,
    private readonly envelopeUrl: string,
    private readonly batchSize = 64,
    private readonly flushIntervalMs = 5000,
    private readonly bufferSize = 1024,
  ) {}

  export(traceEvent: MeshTraceEvent): void {
    if (this.disposed) {
      return;
    }
    if (this.buffer.length >= this.bufferSize) {
      return; // full buffer drops the new event, lossy by design
    }
    this.buffer.push(traceEvent);
    this.ensureTimer();
    if (this.buffer.length >= this.batchSize) {
      void this.drain();
    }
  }

  /** Flushes any buffered events now (used by tests and by `disposeAsync`). */
  async flushAsync(): Promise<void> {
    await this.drain();
  }

  async disposeAsync(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.drain(); // flush the tail
  }

  dispose(): void {
    void this.disposeAsync();
  }

  private ensureTimer(): void {
    if (this.timer !== undefined || this.disposed) {
      return;
    }
    this.timer = setInterval(() => void this.drain(), this.flushIntervalMs);
    // Don't let the flush loop keep a Node process alive on its own.
    this.timer.unref?.();
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return; // single reader, matching the C# channel's SingleReader pump
    }
    this.draining = true;
    try {
      while (this.buffer.length > 0) {
        await this.flush(this.buffer.splice(0, this.batchSize));
      }
    } finally {
      this.draining = false;
    }
  }

  private async flush(batch: MeshTraceEvent[]): Promise<void> {
    if (batch.length === 0) {
      return;
    }
    try {
      const traceBatch = new MeshTraceBatch();
      traceBatch.events = batch;
      const envelope = {
        topic: MeshTopics.traces,
        headers: {} as Record<string, string>,
        body: MeshJson.serialize(traceBatch),
      };
      await this.fetchFn(this.envelopeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      // a rejected batch is dropped, not retried - lossy by design
    } catch {
      // an unreachable collector reduces the mesh, never the service
    }
  }
}
