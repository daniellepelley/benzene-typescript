/** Port of Benzene.Resilience.Polly.BenzeneFailureResultException. */

/**
 * The sentinel error {@link CockatielResilienceMiddleware} throws internally when a configured
 * `isFailure` predicate reports that the pipeline produced an unsuccessful result (rather than
 * throwing). This lets a cockatiel policy treat an unsuccessful `IBenzeneResult` as a handled outcome —
 * retry it, trip a circuit breaker on it, fall back from it — since Benzene middleware reports domain
 * failure as a result on the context, not as a thrown exception (see the spec's core-concepts §5).
 *
 * To act on failure results, configure your cockatiel policy to handle this type, e.g.
 * `retry(handleType(BenzeneFailureResultException), { maxAttempts: 3 })`. The middleware never lets this
 * error escape: once the policy has finished (all retries exhausted), it is swallowed and the last
 * unsuccessful result remains on the context, exactly as if no resilience middleware were present. A
 * *real* error thrown by the pipeline is never wrapped and propagates normally.
 *
 * PORTING NOTE: C# `Exception` subclass → an `Error` subclass that sets `name` (matching the port's
 * `OperationCanceledException` convention).
 */
export class BenzeneFailureResultException extends Error {
  constructor() {
    super('The Benzene pipeline produced an unsuccessful result (surfaced to the cockatiel policy as a handled outcome).');
    this.name = 'BenzeneFailureResultException';
  }
}
