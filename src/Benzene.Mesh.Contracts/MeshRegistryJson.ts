/** Port of Benzene.Mesh.Contracts.MeshRegistryJson. */
import { MeshServiceRegistry } from './MeshServiceRegistry';
import { MeshServiceRegistryEntry } from './MeshServiceRegistryEntry';
import { MeshServiceSource } from './MeshServiceSource';

interface RegistryEntryDto {
  name: string;
  specUrl?: string;
  healthUrl?: string;
  source: string;
  sourceOptions?: Record<string, string>;
  owningTeam?: string;
}

interface RegistryDto {
  services?: RegistryEntryDto[];
}

/**
 * Serializes/deserializes a `MeshServiceRegistry` to the `mesh.json`
 * `{ "services": [ { name, specUrl, healthUrl, source, sourceOptions, owningTeam } ] }` shape.
 *
 * C#'s `JsonSerializerOptions` (camelCase, ignore-null, indented) maps to: TS property names are already
 * camelCase, null/undefined entries are omitted from the DTO before `JSON.stringify(..., null, 2)`.
 */
export const MeshRegistryJson = {
  /** Serializes the registry to the `mesh.json` services-document JSON (2-space indented). */
  serialize(registry: MeshServiceRegistry): string {
    const dto: RegistryDto = { services: registry.services.map(toDto) };
    return JSON.stringify(dto, null, 2);
  },

  /** Deserializes a `mesh.json` services-document back into a registry. */
  deserialize(json: string): MeshServiceRegistry {
    const dto = JSON.parse(json) as RegistryDto | null;
    const services = (dto?.services ?? []).map(fromDto);
    return new MeshServiceRegistry(services);
  },
};

function toDto(entry: MeshServiceRegistryEntry): RegistryEntryDto {
  const dto: RegistryEntryDto = { name: entry.name, source: entry.source };
  if (entry.specUrl !== '') {
    dto.specUrl = entry.specUrl;
  }
  if (entry.healthUrl !== '') {
    dto.healthUrl = entry.healthUrl;
  }
  if (entry.sourceOptions !== undefined) {
    dto.sourceOptions = { ...entry.sourceOptions };
  }
  if (entry.owningTeam !== undefined) {
    dto.owningTeam = entry.owningTeam;
  }
  return dto;
}

function fromDto(dto: RegistryEntryDto): MeshServiceRegistryEntry {
  return new MeshServiceRegistryEntry(
    dto.name,
    dto.specUrl ?? '',
    dto.healthUrl ?? '',
    dto.source ?? MeshServiceSource.http,
    dto.sourceOptions,
    dto.owningTeam,
  );
}
