/** Port of Benzene.Mesh.Contracts.MeshServiceSnapshot. */
import { HealthCheckResponse } from '@benzene/health-checks-core';

/**
 * The full per-service artifact a mesh aggregator publishes each run - the `services/{name}.json` shape.
 * `DateTimeOffset` -> epoch ms; `HealthCheckResponse?` -> `| undefined`; nullable strings -> `| undefined`.
 */
export class MeshServiceSnapshot {
  /**
   * @param specJson The raw spec JSON verbatim (not deserialized); `undefined` if the spec couldn't be fetched.
   * @param specHash The hash of `specJson` (see `MeshHashing`); `undefined` if the spec couldn't be fetched.
   * @param contractDrift Whether `specHash` differs from `previousSpecHash`. Always false the first time a service is seen.
   * @param error The exception TYPE NAME thrown while fetching (never the message); `undefined` if none.
   */
  constructor(
    readonly name: string,
    readonly fetchedAtUtc: number,
    readonly specJson: string | undefined,
    readonly specHash: string | undefined,
    readonly previousSpecHash: string | undefined,
    readonly contractDrift: boolean,
    readonly health: HealthCheckResponse | undefined,
    readonly error: string | undefined,
  ) {}
}
