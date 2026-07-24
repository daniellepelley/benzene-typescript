/** Port of Benzene.Mesh.Contracts.MeshAnnotation. */

/**
 * One recorded note in the mesh's discussion log - a human's remark attached to an entity of the estate.
 * `author` is a self-declared display name, deliberately not an authenticated identity (authentication is
 * the deployment's gateway's job). `DateTimeOffset` -> epoch ms.
 */
export class MeshAnnotation {
  /** @param entity `"service:<name>"` or `"topic:<topicId>"`. */
  constructor(
    readonly id: string,
    readonly entity: string,
    readonly author: string,
    readonly text: string,
    readonly createdAtUtc: number,
  ) {}
}
