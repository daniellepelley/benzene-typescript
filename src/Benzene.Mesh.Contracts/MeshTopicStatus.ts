/** Port of Benzene.Mesh.Contracts.MeshTopicStatus. */

/**
 * The informational signal values `MeshTopicEntry.status` can report. Neither value is an error - both
 * are prompts to look, not failures.
 */
export const MeshTopicStatus = {
  /** At least one producer declared, but no service handles it anymore - a candidate for retiring. */
  deprecationCandidate: 'deprecation-candidate',

  /** Consumed by at least one service (all non-HTTP) but no service declares producing it. */
  gap: 'gap',
} as const;
