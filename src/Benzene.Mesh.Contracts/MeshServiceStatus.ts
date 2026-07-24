/** Port of Benzene.Mesh.Contracts.MeshServiceStatus. */

/** The status values a `MeshManifestEntry` can report. Loose string constants, matching `HealthCheckStatus`. */
export const MeshServiceStatus = {
  /** The service's health endpoint was reachable and reported healthy. */
  healthy: 'healthy',

  /** The service's health endpoint was reachable but reported unhealthy. */
  unhealthy: 'unhealthy',

  /** Neither the spec nor the health endpoint could be reached. */
  unreachable: 'unreachable',
} as const;
