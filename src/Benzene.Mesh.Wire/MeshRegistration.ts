/**
 * The body of a `benzene:mesh:register` message (docs/specification/mesh.md §2): the service's Contract
 * Document - the same document its reserved `benzene:spec` topic serves (contract-document.md §1), with the
 * deployment-side fields it knows (`runtime`, `placement`, `profile`, `degraded`).
 *
 * A service never builds this by hand: `@benzenejs/schema-openapi`'s `SpecBuilder` derives the document, and the
 * cloud service's announcer registers exactly what `benzene:spec` serves. This type is the collector's reading of
 * a received body, so every member but `service` is optional (mesh.md §2, "What a collector requires"): a member
 * that is absent, or that `degraded` names, is unknown - no edges, and no undeclared-edge drift on its topics.
 * Schemas are carried but never interpreted, and the dialect is never checked here.
 */
import { JsonObject } from './MeshJson';

/** One entry of a registration's `requests`, `events` or `sends` - only what the graph reads is typed. */
export interface MeshRegistrationEntry {
  topic: string;
  version?: string;
  [member: string]: unknown;
}

/** The members of a registration the graph reads (contract-document.md §1 `degraded`'s vocabulary). */
export type MeshRegistrationMember = 'requests' | 'events' | 'sends';

/**
 * A class (not an interface) so it can be the request type token a collector's register handler is bound with;
 * a received body is parsed JSON, never constructed, so readers treat every member as possibly absent.
 */
export class MeshRegistration {
  service = '';
  serviceVersion?: string;
  versionScheme?: string;
  description?: string;
  runtime?: string;
  placement?: MeshPlacement;
  profile?: MeshProfile;
  /** The members the producer could not determine (contract-document.md §1). */
  degraded?: string[];
  messageEndpoint?: string;
  transports?: string[];
  contractHash?: string;
  /** The registration projection's hash (contract-document.md §6) - what heartbeats are compared with (§5). */
  registrationHash?: string;
  /** Topics this service handles: it is their consumer (mesh.md §4). */
  requests?: MeshRegistrationEntry[];
  /** Topics this service publishes and defines: it is their provider (mesh.md §4). */
  events?: MeshRegistrationEntry[];
  /** Topics other services define that this service sends to: it is their provider too (mesh.md §4). */
  sends?: MeshRegistrationEntry[];
  components?: JsonObject;
  [member: string]: unknown;
}

/** Where a service runs (contract-document.md §1 `placement`). Region is emitted only when actually known. */
export class MeshPlacement {
  cloud = '';

  region?: string;
}

/**
 * A named conformance-profile claim (contract-document.md §1 `profile`). `missing` lists the profile's
 * requirement ids the service knows it does not satisfy; undefined or empty means fully conformant to `name`.
 */
export class MeshProfile {
  name = '';

  missing?: string[];
}

export const MeshRegistrations = {
  /**
   * The entries of `member` the graph may read, or `undefined` when the member is **unknown** (mesh.md §2):
   * absent from the body, or named in its `degraded`. `benzene:` entries are dropped (contract-document.md §1),
   * and a malformed entry (no string `topic`) is skipped, never thrown on - no feed fails ingestion (§6).
   */
  known(registration: MeshRegistration, member: MeshRegistrationMember): MeshRegistrationEntry[] | undefined {
    const degraded = Array.isArray(registration.degraded) ? registration.degraded : [];
    const entries = registration[member];
    if (!Array.isArray(entries) || degraded.includes(member)) {
      return undefined;
    }
    return entries.filter(
      (entry): entry is MeshRegistrationEntry =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.topic === 'string' &&
        entry.topic.length > 0 &&
        !entry.topic.toLowerCase().startsWith('benzene:'),
    );
  },
} as const;
