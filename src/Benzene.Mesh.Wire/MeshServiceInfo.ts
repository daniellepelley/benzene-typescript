/** Port of Benzene.Mesh.Wire.MeshServiceInfo. */

/**
 * The static identity a service stamps on what it emits to a collector - its trace events and heartbeats
 * (docs/specification/mesh.md §3, §5). Empty values simply leave the corresponding fields unset.
 *
 * Its registration needs nothing from here: the register body is the Contract Document (mesh.md §2), built by
 * `@benzenejs/schema-openapi`'s `SpecBuilder` from the application info and the deployment info.
 */
export class MeshServiceInfo {
  constructor(
    readonly service: string,
    readonly serviceVersion?: string,
    readonly instanceId?: string,
  ) {}
}
