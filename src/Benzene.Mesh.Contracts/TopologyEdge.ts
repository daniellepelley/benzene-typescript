/** Port of Benzene.Mesh.Contracts.TopologyEdge. */

/**
 * One cross-service call edge in a `MeshTopology` - "`client` calls `server`", from a given
 * `TopologyEdgeSource`. Structural and observed edges for the same pair are kept separate.
 * `double?` -> `number | undefined`.
 */
export class TopologyEdge {
  /**
   * @param source One of `TopologyEdgeSource`.
   * @param requestsPerMinute Observed call rate, or `undefined` if not available for this source.
   * @param errorRate Observed failure ratio (0-1), or `undefined` if not available.
   * @param p50LatencyMs / p95LatencyMs / p99LatencyMs Observed latency percentiles (ms), or `undefined`.
   */
  constructor(
    readonly client: string,
    readonly server: string,
    readonly source: string,
    readonly requestsPerMinute: number | undefined,
    readonly errorRate: number | undefined,
    readonly p50LatencyMs: number | undefined,
    readonly p95LatencyMs: number | undefined,
    readonly p99LatencyMs: number | undefined,
  ) {}
}
