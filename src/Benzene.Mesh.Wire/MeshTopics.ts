/** Port of the MeshTopics constants in Benzene.Mesh.Wire.MeshTraceEvent. */

/**
 * The mesh wire-contract topic names (docs/specification/mesh.md §1/§4), shared by services and
 * collectors. C# `static class` of `const string`s -> a frozen object; the string VALUES are the
 * reserved wire topic ids (lowercase, case-sensitive per wire-contracts.md §3).
 */
export const MeshTopics = {
  /** The reserved descriptor topic a meshed service intercepts (spec §1). */
  descriptor: 'mesh',

  /** A service announces its descriptor to a collector (spec §4). */
  register: 'mesh:register',

  /** A service instance's periodic health report to a collector (spec §5). */
  heartbeat: 'mesh:heartbeat',

  /** A trace exporter's batched events to a collector (spec §4). */
  traces: 'mesh:traces',

  /** An issue emitter's deduplicated failure signatures to a collector (spec §4.1). */
  issues: 'mesh:issues',
} as const;
