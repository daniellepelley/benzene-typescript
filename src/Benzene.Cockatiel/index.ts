/**
 * Port of Benzene.Resilience.Polly — resilience middleware over a third-party resilience library.
 *
 * Where the .NET package adapts [Polly v8](https://www.pollydocs.org/), this adapts its JavaScript
 * analogue [cockatiel](https://github.com/connor4312/cockatiel) (the "adapted, not reimplemented"
 * convention — see the README). It is a **sibling** to `@benzene/resilience` (the zero-dependency
 * homegrown retry), not a replacement: this one takes a `cockatiel` dependency in exchange for the whole
 * toolkit (retry, circuit breaker, timeout, bulkhead, fallback, and compositions via `wrap`).
 *
 * `useResiliencePipeline(app, policy, isFailure?)` runs the rest of the pipeline through a cockatiel
 * `IPolicy`. Pass `isFailure` (and configure the policy to handle `BenzeneFailureResultException`) to
 * make an unsuccessful `IBenzeneResult` — not just a thrown error — a handled outcome.
 */
export * from './BenzeneFailureResultException';
export * from './CockatielResilienceMiddleware';
export * from './Extensions';
