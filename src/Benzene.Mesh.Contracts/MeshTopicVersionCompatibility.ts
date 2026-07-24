/** Port of Benzene.Mesh.Contracts.MeshTopicVersionCompatibility. */

/**
 * A topic-level reconciliation of which payload VERSIONS the fleet produces against which it consumes - the
 * "are producers and consumers version-compatible" view. `producedNotConsumed` is the load-bearing signal
 * (a forward-compatibility risk); an upcaster on the consumer may transparently bridge it, so a skew is a
 * prompt to confirm the upcaster exists, not a proven break.
 */
export class MeshTopicVersionCompatibility {
  /**
   * @param producedVersions Every version some service declares producing (empty string = unversioned).
   * @param consumedVersions Every version some service handles (empty string = unversioned).
   * @param producedNotConsumed Versions produced somewhere but handled by no service at that version.
   * @param consumedNotProduced Versions handled somewhere but produced by no service.
   */
  constructor(
    readonly topic: string,
    readonly producedVersions: string[],
    readonly consumedVersions: string[],
    readonly producedNotConsumed: string[],
    readonly consumedNotProduced: string[],
  ) {}

  /** True when every produced version has a matching consumer at that version (no `producedNotConsumed`). */
  get isCompatible(): boolean {
    return this.producedNotConsumed.length === 0;
  }
}
