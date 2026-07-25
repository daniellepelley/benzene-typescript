/** Port of Benzene.Mesh.Wire.MeshServiceDescriptor (and its MeshProfile/MeshTopicDescriptor/MeshPlacement). */
import { JsonObject } from './MeshJson';

/**
 * The mesh ServiceDescriptor wire shape (docs/specification/mesh.md §2): the service's
 * self-description, derived at startup from the message-handler registry - never hand-maintained.
 * Also the body of a `mesh:register` message (§4). Wire field names are camelCase; optional fields
 * are `undefined` (not `null`) so `MeshJson.serialize` omits them (the C# `WhenWritingNull`).
 *
 * `runtime` defaults to `"node"` - the implementing port identifier for this TypeScript port
 * (the C# original defaults to `"dotnet"`). Per §2.2 the hash is per-port by design, so this value
 * is never compared across ports.
 */
export class MeshServiceDescriptor {
  service = '';

  serviceVersion?: string;

  instanceId?: string;

  runtime = 'node';

  binding?: string;

  placement: MeshPlacement = new MeshPlacement();

  topics: MeshTopicDescriptor[] = [];

  descriptorHash?: string;

  /**
   * Names the feeds that were unavailable when the descriptor was built (spec §2: currently only
   * "registry"), so a reduced descriptor is distinguishable from a service with no topics.
   */
  degraded?: string[];

  /**
   * The service's self-assessed conformance profile (spec §2), when it claims one - e.g. the
   * Cloud Service Profile. Optional; omitted by services that don't self-assess. Like `degraded`,
   * this is self-description status rather than contract, so it is excluded from the descriptor hash.
   */
  profile?: MeshProfile;
}

/**
 * A named conformance-profile claim carried on the descriptor (spec §2's `profile` field).
 * `missing` lists the profile's requirement ids the service knows it does not satisfy; undefined or
 * empty means the service self-assesses as fully conformant to `name`.
 */
export class MeshProfile {
  name = '';

  missing?: string[];
}

/** One registered topic in a descriptor (spec §2), with the §2.1-derived payload schemas. */
export class MeshTopicDescriptor {
  id = '';

  version?: string;

  requestSchema?: JsonObject;

  responseSchema?: JsonObject;
}

/** Where a service instance runs (spec §2). Region is emitted only when actually known. */
export class MeshPlacement {
  cloud = '';

  region?: string;
}
