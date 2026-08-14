/** Port of Benzene.CloudService.MeshAnnouncer. */
import { IServiceResolver } from '@benzenejs/abstractions';
import { Constants, HealthCheckProcessor } from '@benzenejs/health-checks';
import { HealthCheckResponse, IHealthCheck } from '@benzenejs/health-checks-core';
import {
  MeshHeartbeat,
  MeshJson,
  MeshServiceDescriptor,
  MeshServiceInfo,
  MeshTopics,
} from '@benzenejs/mesh-wire';
import { CloudServiceDescriptorSource } from './CloudServiceDescriptorSource';

/** A `fetch`-like function — the port of C# `HttpClient.PostAsync` (`HttpClient` → injectable `fetch`). */
export type AnnouncerFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The outbound announcement half of the mesh feeds (mesh.md §4–§5): registers the service's descriptor with
 * the collector on startup (retrying until the collector is up), then heartbeats on an interval, carrying the
 * aggregated health check response and the descriptor hash.
 *
 * The §6 degradation rule applies throughout: every failure — collector down, send faulted, health check
 * throwing — is swallowed and retried on the next tick, and nothing here ever runs on, blocks, or fails an
 * invocation. Started at wire-up when the descriptor is available eagerly, otherwise by the first invocation
 * (see {@link MeshAnnouncer.ensureStarted}).
 *
 * Divergences from C#: `HttpClient.PostAsync` → the global `fetch` (no new dependency), as `HttpMeshTraceExporter`
 * does. The `CancellationTokenSource` → an `AbortController` (aborts the in-flight send and wakes the delay).
 * `IAsyncDisposable`+`IDisposable` → `disposeAsync()` with a fire-and-forget `dispose()` bridge (JavaScript
 * cannot block a thread on a promise, so the C# bounded `Wait(5s)` bridge cannot be reproduced; the
 * cancellation is already signalled, so the loop winds down on its own). The single-threaded runtime removes
 * the need for `Interlocked`.
 */
export class MeshAnnouncer {
  private static readonly defaultHttp: AnnouncerFetch = (url, init) => fetch(url, init);

  private readonly healthChecks: IHealthCheck[];
  private readonly fetchFn: AnnouncerFetch;
  private readonly heartbeatIntervalMs: number;
  private readonly abortController = new AbortController();
  private started = false;
  private stopping = false;
  private runPromise?: Promise<void>;

  constructor(
    private readonly info: MeshServiceInfo,
    private readonly descriptorSource: CloudServiceDescriptorSource,
    private readonly collectorEnvelopeUrl: string,
    healthChecks: IHealthCheck[],
    fetchFn?: AnnouncerFetch,
    heartbeatIntervalMs = 10000,
  ) {
    this.healthChecks = [...healthChecks];
    this.fetchFn = fetchFn ?? MeshAnnouncer.defaultHttp;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  /**
   * Starts the announce loop exactly once; safe to call from every invocation. The `resolver` is used only if
   * the descriptor still needs deriving from the registry (the lazy path); pass `undefined` when the
   * descriptor was built eagerly.
   */
  ensureStarted(resolver?: IServiceResolver): void {
    if (this.started) {
      return;
    }

    const descriptor = resolver === undefined ? this.descriptorSource.tryGet() : this.descriptorSource.get(resolver);
    if (descriptor === undefined) {
      // No descriptor available yet (lazy path started without a resolver) — let the next invocation try
      // again rather than announcing an empty contract.
      return;
    }

    this.started = true;
    this.runPromise = this.runAsync(descriptor);
  }

  private async runAsync(descriptor: MeshServiceDescriptor): Promise<void> {
    try {
      while (!this.stopping) {
        if (await this.sendAsync(MeshTopics.register, MeshJson.serialize(descriptor))) {
          break;
        }
        await this.delay(2000);
      }

      while (!this.stopping) {
        const heartbeat = new MeshHeartbeat();
        heartbeat.service = this.info.service;
        heartbeat.instanceId = this.info.instanceId;
        heartbeat.descriptorHash = descriptor.descriptorHash;
        heartbeat.sentAt = Date.now();
        heartbeat.health = await this.getHealthAsync();
        await this.sendAsync(MeshTopics.heartbeat, MeshJson.serialize(heartbeat));
        await this.delay(this.heartbeatIntervalMs);
      }
    } catch {
      // stopping — nothing to clean up; a collector notices via missing heartbeats (spec §6)
    }
  }

  private async getHealthAsync(): Promise<HealthCheckResponse> {
    try {
      const result = await HealthCheckProcessor.performHealthChecksAsync(
        Constants.defaultHealthCheckTopic,
        this.healthChecks,
      );
      const payload = result.payloadAsObject;
      return payload instanceof HealthCheckResponse ? payload : new HealthCheckResponse(result.isSuccessful, {});
    } catch {
      // a broken check must degrade the heartbeat's payload, never stop the heartbeats
      return new HealthCheckResponse(false, {});
    }
  }

  private async sendAsync(topic: string, body: string): Promise<boolean> {
    try {
      const envelope = JSON.stringify({ topic, headers: {} as Record<string, string>, body });
      const response = await this.fetchFn(this.collectorEnvelopeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: envelope,
        signal: this.abortController.signal,
      });
      return response.ok;
    } catch {
      return false; // collector down: reduced mesh, never a service failure (spec §6)
    }
  }

  /** A cancellable delay: resolves after `ms`, or immediately when disposal aborts the controller. */
  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.stopping) {
        resolve();
        return;
      }
      const signal = this.abortController.signal;
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      // Don't let the announce loop keep a Node process alive on its own.
      timer.unref?.();
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async disposeAsync(): Promise<void> {
    this.stopping = true;
    this.abortController.abort();

    const runPromise = this.runPromise;
    if (runPromise !== undefined) {
      try {
        await runPromise;
      } catch {
        // best-effort shutdown of side-channel telemetry (spec §6) — never throw from dispose
      }
    }
  }

  /**
   * Synchronous disposal bridge. JavaScript cannot block on a promise, so — unlike the C# bounded
   * `Wait(5s)` — this is fire-and-forget: the cancellation is already signalled, so the announce loop
   * (side-channel telemetry, spec §6) winds down on its own. Mirrors `HttpMeshTraceExporter.dispose`.
   */
  dispose(): void {
    void this.disposeAsync();
  }
}
