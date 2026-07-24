/** Port of Benzene.Mesh.Contracts.MeshManifest. */
import { MeshManifestEntry } from './MeshManifestEntry';

/**
 * The top-level index the aggregator publishes each run - the `manifest.json` shape. A catalog/topology UI
 * reads this first, then drills into individual `MeshServiceSnapshot` artifacts.
 * C#'s `DateTimeOffset` -> epoch-millisecond `number` (the port's date convention).
 */
export class MeshManifest {
  constructor(
    readonly generatedAtUtc: number,
    readonly services: MeshManifestEntry[],
  ) {}
}
