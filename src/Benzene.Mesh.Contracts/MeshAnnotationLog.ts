/** Port of Benzene.Mesh.Contracts.MeshAnnotationLog. */
import { MeshAnnotation } from './MeshAnnotation';

/**
 * The `annotations.json` shape - every recorded `MeshAnnotation`, published into the same artifact store as
 * `manifest.json`/`topics.json` (a static-servable read path; only the write path needs a live endpoint).
 */
export class MeshAnnotationLog {
  /** @param annotations Every recorded annotation, oldest first; readers group by `entity`. */
  constructor(
    readonly generatedAtUtc: number,
    readonly annotations: MeshAnnotation[],
  ) {}
}
