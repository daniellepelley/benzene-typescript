/** Port of Benzene.Mesh.Contracts.MeshManifestEntry. */

/**
 * One row in a `MeshManifest` - a summary of one service's latest snapshot, denormalized so a catalog view
 * can render service status without fetching every service's full `MeshServiceSnapshot`.
 */
export class MeshManifestEntry {
  readonly owningTeam: string | undefined;
  readonly transports: readonly string[];
  readonly snapshotAtUtc: number | undefined;

  /**
   * @param status One of `MeshServiceStatus`.
   * @param contractDrift Whether this service's spec changed since the previous run.
   * @param transports Transport names this service receives over (from the spec); empty when unadvertised.
   * @param snapshotAtUtc When the underlying snapshot was taken (epoch ms); `undefined` on older manifests.
   */
  constructor(
    readonly name: string,
    readonly status: string,
    readonly contractDrift: boolean,
    readonly specUrl: string,
    readonly healthUrl: string,
    owningTeam?: string,
    transports: readonly string[] = [],
    snapshotAtUtc?: number,
  ) {
    this.owningTeam = owningTeam;
    this.transports = transports;
    this.snapshotAtUtc = snapshotAtUtc;
  }
}
