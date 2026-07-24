/** Port of Benzene.Mesh.Contracts.MeshAnnotationThread. */
import { MeshAnnotation } from './MeshAnnotation';

/**
 * The `mesh:annotations:add` response: the annotated entity's full thread after the append, so a UI can
 * re-render the discussion it just posted into without re-fetching the `annotations.json` artifact.
 */
export class MeshAnnotationThread {
  /** @param annotations Every annotation on that entity, oldest first. */
  constructor(
    readonly entity: string,
    readonly annotations: MeshAnnotation[],
  ) {}
}
