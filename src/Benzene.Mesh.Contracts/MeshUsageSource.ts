/** Port of Benzene.Mesh.Contracts.MeshUsageSource. */

/** Well-known `MeshUsageEntry.source` values - which adapter produced a usage entry. Open string constants. */
export const MeshUsageSource = {
  /** Produced by the mesh collector's in-process trace-stats bridge: counts per (topic, version, status). */
  collector: 'collector',

  /** Produced by the CloudWatch usage adapter: counts per (topic, transport, status) over a window. */
  cloudWatch: 'cloudwatch',

  /** Produced by the Application Insights usage adapter: the Azure sibling of `cloudWatch`. */
  applicationInsights: 'application-insights',
} as const;
