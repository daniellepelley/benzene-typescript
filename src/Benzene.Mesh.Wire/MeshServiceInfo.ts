/** Port of Benzene.Mesh.Wire.MeshServiceInfo. */
import { MeshPlacement } from './MeshServiceDescriptor';

/**
 * The static identity a service supplies to `MeshDescriptorFactory` (docs/specification/mesh.md §2).
 * Every field is optional; empty values simply leave the corresponding descriptor fields unset.
 */
export class MeshServiceInfo {
  constructor(
    readonly service: string,
    readonly serviceVersion?: string,
    readonly instanceId?: string,
    readonly binding?: string,
    readonly placement?: MeshPlacement,
  ) {}
}
