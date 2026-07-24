/** Port of Benzene.Mesh.Contracts.TopologyEdgeSource. */

/** The origin of a `TopologyEdge` - which technique produced it. */
export const TopologyEdgeSource = {
  /** A "designed to call" edge derived from the fleet's declared contracts (producers -> consumers). */
  structural: 'structural',

  /** An "actually calling, and how it's performing" edge derived from observed traffic (real spans). */
  tempo: 'tempo',
} as const;
