/** Port of the MeshTopics constants in Benzene.Mesh.Wire.MeshTraceEvent. */
import { BenzeneTopic } from '@benzenejs/abstractions';

/**
 * The mesh wire-contract topic names (docs/specification/mesh.md §1/§4), shared by services and
 * collectors. C# `static class` of `const string`s -> a frozen object; the string VALUES are the
 * reserved wire topic ids (lowercase, case-sensitive per wire-contracts.md §3).
 *
 * All ids carry the `benzene:` marker per the naming principle - they live in the same namespace as
 * the application's topics, so they say whose they are. They sit here rather than on
 * {@link BenzeneTopic} because the mesh is an optional add-on and the root abstraction deliberately
 * doesn't know about it; `BenzeneTopic.isReserved` still recognises them, because it tests the prefix
 * rather than a list.
 */
export const MeshTopics = {
  /** The reserved descriptor topic a meshed service intercepts (spec §1). */
  descriptor: BenzeneTopic.mesh,

  /** A service announces its descriptor to a collector (spec §4). */
  register: 'benzene:mesh:register',

  /** A service instance's periodic health report to a collector (spec §5). */
  heartbeat: 'benzene:mesh:heartbeat',

  /** A trace exporter's batched events to a collector (spec §4). */
  traces: 'benzene:mesh:traces',

  /** An issue emitter's deduplicated failure signatures to a collector (spec §4.1). */
  issues: 'benzene:mesh:issues',
} as const;
