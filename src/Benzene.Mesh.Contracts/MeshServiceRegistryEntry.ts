/** Port of Benzene.Mesh.Contracts.MeshServiceRegistryEntry. */
import { MeshServiceSource } from './MeshServiceSource';

/**
 * One entry in a `MeshServiceRegistry` - a human-maintained record of where to find a service's spec and
 * health endpoints, and how to fetch them. Not generated; the input a mesh aggregator polls.
 *
 * C#'s two constructors (HTTP-defaulted and explicit-source) collapse into one with optional `source`/
 * `sourceOptions`/`owningTeam`; the HTTP shortcut is `new MeshServiceRegistryEntry(name, specUrl, healthUrl)`.
 * `IReadOnlyDictionary<string, string>` -> `Record<string, string>`.
 */
export class MeshServiceRegistryEntry {
  readonly source: string;
  readonly sourceOptions: Record<string, string> | undefined;
  readonly owningTeam: string | undefined;

  constructor(
    readonly name: string,
    readonly specUrl: string,
    readonly healthUrl: string,
    source: string = MeshServiceSource.http,
    sourceOptions?: Record<string, string>,
    owningTeam?: string,
  ) {
    this.source = source;
    this.sourceOptions = sourceOptions;
    this.owningTeam = owningTeam;
  }
}
