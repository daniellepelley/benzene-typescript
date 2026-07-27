/** Port of Benzene.HealthChecks.Core.HealthCheckMode. */

/**
 * How a client health check verifies its dependency. The default (`reachability`) is a
 * non-destructive read-only probe safe to poll; `active` opts in to exercising the real write/invoke
 * path and is side-effecting.
 *
 * C# `enum` -> a frozen const object of string values (TypeScript-idiomatic; the values are stable
 * discriminators, not ordinals, so a check can report under a distinct `"<Type>.Active"` type).
 */
export const HealthCheckMode = {
  /**
   * Non-destructive reachability: a read-only control-plane call (e.g. describe/get-attributes) that
   * confirms the resource exists, is reachable, and the credentials can see it. The default — safe to
   * poll. It does **not** prove a write/invoke would succeed (that needs a different permission), only
   * that the resource is reachable.
   */
  reachability: 'reachability',

  /**
   * Actively exercises the write/invoke path (send a message, invoke the function, start an
   * execution). **Side-effecting** — opt in only. Keep it off liveness/readiness probes and off a
   * frequent poll. Reported under a distinct `"<Type>.Active"` check type so it never shares a cache
   * key with the reachability check.
   */
  active: 'active',
} as const;

/** The type of a `HealthCheckMode` value. */
export type HealthCheckMode = (typeof HealthCheckMode)[keyof typeof HealthCheckMode];
