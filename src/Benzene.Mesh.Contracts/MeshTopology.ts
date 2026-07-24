/** Port of Benzene.Mesh.Contracts.MeshTopology. */
import { TopologyEdge } from './TopologyEdge';

/** Cross-service call edges published by a topology source - the `topology.json` shape. */
export class MeshTopology {
  constructor(
    readonly generatedAtUtc: number,
    readonly edges: TopologyEdge[],
  ) {}
}
