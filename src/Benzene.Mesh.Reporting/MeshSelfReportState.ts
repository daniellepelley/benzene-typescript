/** Port of Benzene.Mesh.Reporting.MeshSelfReportState. */

/**
 * Tracks when `MeshSelfReportMiddleware` last published, so the `minimumIntervalMs` throttle survives across
 * requests within one running process. Registered as a singleton (not static) so independent pipelines
 * don't share type-local state.
 *
 * C#'s `Interlocked`-guarded `long` ticks collapse to a plain `number | undefined` (epoch ms): Node is
 * single-threaded, so there's no torn read/write to guard against. On an ephemeral host this resets on cold
 * start (an idle instance stops reporting rather than reporting stale data forever).
 */
export class MeshSelfReportState {
  /** When the middleware last published (epoch ms), or `undefined` if it never has. */
  lastPublishedAtUtc: number | undefined;
}
