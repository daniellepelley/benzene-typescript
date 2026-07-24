/** Port of Benzene.Mesh.Dispatch.MeshDispatchOptions. */

/** Configuration for the opt-in mesh dispatch feature. Resolved from the container by its own class. */
export class MeshDispatchOptions {
  /**
   * Whether dispatch is permitted in Production. Defaults to `false`: a dispatch invokes a target
   * service's REAL handler with caller-supplied data (real side-effects execute), so it stays off in
   * Production unless a human deliberately opts in.
   */
  allowInProduction = false;
}
