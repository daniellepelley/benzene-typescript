/** Port of Benzene.Mesh.Reporting.MeshSelfReportMiddleware. */
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { HealthCheckResponse } from '@benzene/health-checks-core';
import { IMeshReportPublisher, MeshServiceReport } from '@benzene/mesh-contracts';
import { MeshSelfReportOptions } from './MeshSelfReportOptions';
import { MeshSelfReportState } from './MeshSelfReportState';

/**
 * After a real request/message completes, opportunistically publishes this service's current spec/health via
 * the injected `IMeshReportPublisher` - piggybacking on real traffic rather than a dedicated scheduled
 * reporter. Throttled by `MeshSelfReportOptions.minimumIntervalMs` (tracked in `MeshSelfReportState`).
 *
 * Publishing is fire-and-forget and fully best-effort: it never delays the wrapped response, and a publish
 * failure (or a provider throwing) is swallowed - side-channel telemetry, not part of the primary path.
 */
export class MeshSelfReportMiddleware<TContext> implements IMiddleware<TContext> {
  constructor(
    private readonly publisher: IMeshReportPublisher,
    private readonly options: MeshSelfReportOptions,
    private readonly state: MeshSelfReportState,
  ) {}

  get name(): string {
    return 'MeshSelfReport';
  }

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    await next();

    if (this.shouldPublish()) {
      // Fire-and-forget: not awaited, so the wrapped response is never delayed. Errors are handled inside.
      void this.publishBestEffortAsync();
    }
  }

  private shouldPublish(): boolean {
    const last = this.state.lastPublishedAtUtc;
    return last === undefined || Date.now() - last >= this.options.minimumIntervalMs;
  }

  private async publishBestEffortAsync(): Promise<void> {
    // Set before attempting the publish, not after - so a burst of concurrent requests don't all see "no
    // recent publish" and race. A failed attempt still counts toward the throttle window, deliberately.
    this.state.lastPublishedAtUtc = Date.now();

    try {
      let specJson: string | undefined;
      let health: HealthCheckResponse | undefined;
      let error: string | undefined;

      try {
        specJson = await this.options.specProvider();
      } catch (ex) {
        error = errorName(ex);
      }

      try {
        health = await this.options.healthProvider();
      } catch (ex) {
        error ??= errorName(ex);
      }

      const report = new MeshServiceReport(this.options.serviceName, Date.now(), specJson, health, error);
      await this.publisher.publishAsync(report);
    } catch {
      // Best-effort side-channel telemetry - a publish failure must never affect the primary path.
    }
  }
}

/** Mirrors C#'s `ex.GetType().Name`. */
function errorName(ex: unknown): string {
  return ex instanceof Error ? ex.name : typeof ex;
}
