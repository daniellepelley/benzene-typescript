/** Port of Benzene.Mesh.Contracts.MeshDiscoveryFilter. */

/** The default tag/label key a resource must carry to be discovered. */
export const DefaultTagKey = 'benzene';

/**
 * The filter an `IMeshDiscoveryProvider` applies when enumerating services - which resources count as
 * Benzene services worth interrogating. Defaults to "carries the `benzene` tag/label" but is fully
 * user-overridable.
 *
 * C#'s `IReadOnlyDictionary<string, string?>` tags -> `Record<string, string | null>` (a `null` value means
 * "present with any value"); `IReadOnlyList<string>?` regions -> `string[] | undefined`.
 */
export class MeshDiscoveryFilter {
  readonly tags: Record<string, string | null>;
  readonly regions: string[] | undefined;
  readonly namespace: string | undefined;

  /**
   * @param tags Required tags/labels: key must be present, a non-null value must match exactly. Defaults to
   * `{ benzene: null }`.
   * @param regions Optional region scoping (AWS/Azure); `undefined` = the provider's default region(s).
   * @param namespace Optional namespace scoping (Kubernetes); `undefined` = provider default/all.
   */
  constructor(tags?: Record<string, string | null>, regions?: string[], namespace?: string) {
    this.tags = tags ?? { [DefaultTagKey]: null };
    this.regions = regions;
    this.namespace = namespace;
  }

  /**
   * Returns whether a resource carrying `resourceTags` satisfies this filter - every required key must be
   * present, and every required non-null value must match exactly.
   */
  matches(resourceTags: Record<string, string>): boolean {
    for (const [key, required] of Object.entries(this.tags)) {
      if (!Object.prototype.hasOwnProperty.call(resourceTags, key)) {
        return false;
      }
      if (required !== null && required !== resourceTags[key]) {
        return false;
      }
    }
    return true;
  }
}
