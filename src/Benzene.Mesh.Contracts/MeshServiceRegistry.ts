/** Port of Benzene.Mesh.Contracts.MeshServiceRegistry. */
import { MeshServiceRegistryEntry } from './MeshServiceRegistryEntry';

/** The set of services a mesh aggregator polls on each run - the `mesh.json` registry config. */
export class MeshServiceRegistry {
  constructor(readonly services: MeshServiceRegistryEntry[]) {}
}
