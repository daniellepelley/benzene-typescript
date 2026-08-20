/** Port of Benzene.Abstractions.BenzeneTopic. */

/**
 * The framework-owned reserved topic ids - Benzene's own endpoints, as opposed to the application's
 * topics (see `docs/specification/cloud-service-profile.md` and `docs/specification/mesh.md` §1).
 *
 * Every id here carries the {@link BenzeneTopic.prefix} marker, per the naming principle: **where
 * Benzene puts a name into a namespace it shares with someone else, that name is marked as
 * Benzene's.** Topic ids share a namespace with the application's own topics - `order:create` sits
 * beside these - so a bare `report` or `ping` would be a collision waiting to happen. The prefix also
 * makes "is this Benzene's?" answerable by inspection ({@link BenzeneTopic.isReserved}) instead of by
 * consulting a list that goes stale.
 *
 * This is the single source of truth for these ids, and the topic-side counterpart of
 * `BenzeneResultStatus` (the status vocabulary). Reference these constants rather than re-typing the
 * literal: a duplicated string is how the two drift apart.
 *
 * The mesh's own wire topics (`benzene:mesh:register`, `benzene:mesh:query:fleet`, ...) live in
 * `MeshTopics` in `@benzenejs/mesh-wire`, next to the contract they serve - the mesh is an optional
 * add-on and this root abstraction deliberately doesn't know about it. They carry the same prefix, so
 * {@link BenzeneTopic.isReserved} recognises them too.
 *
 * **No bare-id compatibility shim, deliberately.** Nothing in the port accepts `healthcheck` or `mesh`
 * as an alias for the prefixed id. A shim would make this port *look* interoperable while leaving the
 * caller broken against .NET, Go and Python - the asymmetry the prefix exists to remove - and it buys
 * nothing, because every reserved topic is already an explicit argument
 * (`useHealthCheck(app, topic, checks)`, `useMeshDescriptor(app, descriptor, ...aliases)`): a
 * deployment that must answer a legacy bare id passes it as an alias at its own composition root.
 *
 * C# `static class` of `const string`s + statics -> a frozen object; the string VALUES are the
 * reserved wire topic ids (lowercase, case-sensitive on the wire per wire-contracts.md §3, though
 * both predicates here compare case-insensitively like their C# counterparts).
 */

/**
 * The marker every framework-owned topic id starts with. Note the trailing `:` - the existing
 * namespace separator for topic ids (`benzene:mesh:query:fleet`).
 */
const prefix = 'benzene:';

/** The service's own contract document (Cloud Service Profile R5). */
const spec = 'benzene:spec';

/** Example payloads a caller can use to exercise the service's topics. */
const testPayloads = 'benzene:test-payloads';

/** The deep health check - dependencies included (Profile R3). */
const healthCheck = 'benzene:healthcheck';

/** Liveness: is the process up? Never gated on dependencies. */
const liveness = 'benzene:liveness';

/** Readiness: should this instance receive traffic? */
const readiness = 'benzene:readiness';

/** The mesh descriptor topic a meshed service intercepts (mesh spec §1, Profile R6). */
const mesh = 'benzene:mesh';

/** The transport reachability probe used by the queue/stream health checks. */
const ping = 'benzene:ping';

// Deliberately absent, matching the .NET source of truth:
//   "invoke" - it is an HTTP PATH (/benzene/invoke), never a topic id. Declaring "benzene:invoke"
//     would invent wire surface nothing routes.
//   "report" - the real id is the mesh's own "benzene:mesh:report"; a bare entry is an alias in a
//     filter list that no handler ever binds to.

const all: readonly string[] = Object.freeze([
  spec,
  testPayloads,
  healthCheck,
  liveness,
  readiness,
  mesh,
  ping,
]);

const knownIds = new Set<string>(all.map((id) => id.toLowerCase()));

export const BenzeneTopic = {
  prefix,
  spec,
  testPayloads,
  healthCheck,
  liveness,
  readiness,
  mesh,
  ping,

  /**
   * Whether `topic` is a framework-owned topic - any id carrying the {@link BenzeneTopic.prefix},
   * which covers the ids above *and* the mesh wire topics and any future framework topic. Tooling
   * that hides Benzene's own traffic (the mesh UI's utility filter) should use this rather than
   * maintaining a name list.
   */
  isReserved(topic: string | undefined | null): boolean {
    return topic !== undefined && topic !== null && topic.toLowerCase().startsWith(prefix);
  },

  /**
   * Whether `topic` is one of the specific ids declared here - a narrower test than
   * {@link BenzeneTopic.isReserved}, which accepts any prefixed id.
   */
  isKnown(topic: string | undefined | null): boolean {
    return topic !== undefined && topic !== null && knownIds.has(topic.toLowerCase());
  },

  /** The ids declared here, for tooling that needs to enumerate them. */
  all,
} as const;
