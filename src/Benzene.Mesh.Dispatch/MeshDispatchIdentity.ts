/** Port of Benzene.Mesh.Dispatch.MeshDispatchIdentity. */

/**
 * Who is dispatching, for the duration of one request.
 *
 * Scoped state, set by the session gate / `MeshDispatchGuardMiddleware` wiring and read by the
 * handler, because the two checks that need an identity sit at different layers: the per-identity
 * rate limit is an HTTP-level concern (it should refuse before anything is parsed), while the audit
 * record and the per-target limit need the parsed target service, which only the handler has.
 *
 * It exists at all because a session gate validates the caller's email and then discards it —
 * nothing downstream could say who had dispatched, which would have made every audit record blind.
 */
export class MeshDispatchIdentity {
  /**
   * The signed-in caller, or `undefined` when nothing established one. `undefined` must be treated
   * as a refusal on any path that acts, never as an anonymous allowance.
   */
  email: string | undefined;

  /** The environment label this host is running as, for the audit record. */
  environment: string | undefined;
}
