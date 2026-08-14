# Resilience Pipelines with cockatiel (circuit breaker, timeout, fallback)

Run a Benzene middleware pipeline (or an outbound port call) through a
[cockatiel](https://github.com/connor4312/cockatiel) `IPolicy`, so you get circuit breaker / timeout /
bulkhead / fallback on top of retry — without Benzene wrapping or hiding cockatiel behind its own
abstraction.

> **Port note.** The .NET original adapts [Polly](https://www.pollydocs.org/) in
> `Benzene.Resilience.Polly`. The TypeScript port adapts **cockatiel** — the closest JS analogue — as
> `@benzenejs/cockatiel`, under the "third-party integrations are adapted, not reimplemented" convention.
> Where Polly exposes a mutable `ResiliencePipelineBuilder`, cockatiel composes policies *functionally*
> (`wrap(retry(...), circuitBreaker(...))`), so you build the `IPolicy` you want and pass it in — there
> is no separate builder to configure.

## Problem statement

`@benzenejs/resilience` ships exactly one resilience pattern in-box: retry with exponential backoff
(`useRetry` / `RetryMiddleware<TContext>`) — see [Resilience](../resilience.md). It deliberately does
**not** ship a circuit breaker, timeout, or bulkhead, and has zero runtime dependencies, so it stays the
lightweight option for callers who only want retry.

Everything else — circuit breaker, timeout, bulkhead, fallback, and compositions — comes from the sibling
**`@benzenejs/cockatiel`** package. It takes a `cockatiel` dependency in exchange for the whole toolkit, and
it *exposes* cockatiel rather than wrapping it: you build a policy with exactly the strategies you want and
hand it to `useResiliencePipeline(...)`.

## Prerequisites

- [Node.js 22+](https://nodejs.org/).
- A Benzene middleware pipeline (any transport) built with `IMiddlewarePipelineBuilder<TContext>`. The
  examples below use an AWS Lambda SQS pipeline — see [Handling SQS Message Failures](handling-sqs-failures.md).
- Familiarity with building a cockatiel policy via `retry` / `circuitBreaker` / `timeout` / `wrap` — this
  cookbook doesn't re-teach cockatiel; see its [docs](https://github.com/connor4312/cockatiel) for the
  full strategy catalogue.

## Installation

```bash
npm install @benzenejs/cockatiel cockatiel
```

`@benzenejs/cockatiel` declares `cockatiel` as its one runtime dependency (npm pulls it in transitively, but
install it explicitly so you can import `retry`/`circuitBreaker`/etc. yourself). For retry-only with no
dependency, use `@benzenejs/resilience` instead — see [Just retry](#just-retry-no-cockatiel-dependency).

## Step 1 — build a policy with the strategies you need

Compose whatever cockatiel strategies your service needs — timeout and circuit breaker in this example,
combined with `wrap` (the outermost policy is listed first):

```ts
import {
  wrap,
  timeout,
  circuitBreaker,
  handleAll,
  TimeoutStrategy,
  ConsecutiveBreaker,
} from 'cockatiel';

const policy = wrap(
  // Bound how long we WAIT for a result to 5s (see the timeout caveat below).
  timeout(5_000, TimeoutStrategy.Aggressive),
  // Trip the breaker after 5 consecutive failures; try again after 15s.
  circuitBreaker(handleAll, {
    halfOpenAfter: 15_000,
    breaker: new ConsecutiveBreaker(5),
  }),
);
```

Build a **stateful** policy like a circuit breaker **once** and reuse it — the breaker's open/closed state
lives on the instance, so building a fresh one per message would defeat it. Construct the policy at module
scope (or hold it as a singleton in DI) and pass the same instance into the pipeline.

## Step 2 — wire it into the pipeline

`useResiliencePipeline(app, policy)` runs everything nested after it through the policy. It is a free
function taking the pipeline builder first (the port's shape for what C# writes as a fluent extension
method) and returns the builder for chaining:

```ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useSqs, SqsMessageContext } from '@benzenejs/aws-lambda-sqs';
import { useResiliencePipeline } from '@benzenejs/cockatiel';
import { ProcessOrderHandler } from './ProcessOrderHandler.js';

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) =>
      useSqs(aws, (sqs) => {
        useResiliencePipeline<SqsMessageContext>(sqs, policy); // <-- circuit breaker + timeout here
        useMessageHandlers(sqs, ProcessOrderHandler);
      }),
    );
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

`useResiliencePipeline` is fully generic, like every other Benzene middleware, so it works on any pipeline
context — inbound transport contexts and the outbound `OutboundContext` alike (see
[Outbound clients](#step-4--outbound-clients-the-same-middleware)).

## Step 3 — outcome awareness: acting on a returned failure result

Benzene reports domain failure two ways: a **thrown error**, or an **unsuccessful result** left on the
context (not thrown) — see [Message Results](../message-result.md). cockatiel's strategies fire on thrown
errors, so by default a returned failure *result* is invisible to them.

Pass an `isFailure` predicate to bridge the two. After the pipeline runs, if the predicate returns `true`,
the middleware throws an internal `BenzeneFailureResultException` that cockatiel can treat as a handled
outcome — **but only if you configure the policy to handle it** with `handleType`:

```ts
import { useResiliencePipeline, BenzeneFailureResultException } from '@benzenejs/cockatiel';
import { retry, handleType, ExponentialBackoff } from 'cockatiel';
import { useSqs, SqsMessageContext } from '@benzenejs/aws-lambda-sqs';

useSqs(app, (sqs) => {
  useResiliencePipeline<SqsMessageContext>(
    sqs,
    retry(handleType(BenzeneFailureResultException), {
      maxAttempts: 3,
      backoff: new ExponentialBackoff(),
    }),
    // SqsMessageContext exposes `isSuccessful` (set by the result-setter) — retry a failed record.
    (context) => context.isSuccessful === false,
  );
  useMessageHandlers(sqs, ProcessOrderHandler);
});
```

The sentinel **never escapes**: once the policy finishes (retries exhausted, breaker open, …), it is
swallowed and the last unsuccessful result remains on the context — identical to running with no resilience
middleware. A **real** error is never wrapped and propagates normally (including cockatiel's own
`BrokenCircuitError` when a breaker is open and `TaskCancelledError` from a `timeout` policy). With no
`isFailure` (the default), only thrown errors drive the strategies.

## Step 4 — outbound clients: the same middleware

Because `useResiliencePipeline(...)` is fully generic, it works on an outbound route exactly the way
`@benzenejs/resilience`'s inbound `useRetry` does — this is the higher-value case, since Benzene's whole
thesis is wrapping port calls. Add it to an [outbound route's](../clients.md) pipeline:

```ts
import { addOutboundRouting, OutboundContext } from '@benzenejs/clients';
import { useResiliencePipeline } from '@benzenejs/cockatiel';

addOutboundRouting(services, (routing) =>
  routing.route('order:create', (pipeline) => {
    useResiliencePipeline<OutboundContext>(pipeline, policy); // reuse the shared breaker instance
    pipeline.useService(PublishOrderCreated); // your terminal send middleware
  }),
);
```

## Timeout caveat

Benzene's `IMiddleware` seam carries no cancellation token, so the middleware calls `next()` without
threading cockatiel's per-execution `AbortSignal`. A `timeout` policy therefore *rejects* on time
(`TaskCancelledError`, which propagates) but does **not** actually abort the in-flight handler — `next()`
runs to completion in the background. Use `timeout` to bound how long you *wait* for a result, not to
cancel work already started.

## Testing

A cockatiel policy is a real object you can construct directly in a test — and
`CockatielResilienceMiddleware<TContext>` is a plain `IMiddleware<TContext>` you can drive without a host.
Here retry re-runs `next()` until it stops throwing:

```ts
import { describe, expect, it } from 'vitest';
import { retry, handleAll } from 'cockatiel';
import { CockatielResilienceMiddleware } from '@benzenejs/cockatiel';

describe('cockatiel resilience middleware', () => {
  it('retries a throwing pipeline until it succeeds', async () => {
    const policy = retry(handleAll, { maxAttempts: 3 });
    const middleware = new CockatielResilienceMiddleware<object>(policy);

    let attempts = 0;
    await middleware.handleAsync({}, () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('transient');
      }
      return Promise.resolve();
    });

    expect(attempts).toBe(3); // failed twice, succeeded on the third attempt
  });

  it('surfaces a failure RESULT as a handled outcome when isFailure is supplied', async () => {
    const { BenzeneFailureResultException } = await import('@benzenejs/cockatiel');
    const policy = retry(handleType(BenzeneFailureResultException), { maxAttempts: 3 });

    const context = { isSuccessful: false as boolean };
    const middleware = new CockatielResilienceMiddleware<typeof context>(
      policy,
      (ctx) => ctx.isSuccessful === false,
    );

    let attempts = 0;
    await middleware.handleAsync(context, () => {
      attempts++;
      return Promise.resolve(); // never throws — failure is a result on the context
    });

    expect(attempts).toBe(3); // the sentinel drove the retries…
    expect(context.isSuccessful).toBe(false); // …and never escaped
  });
});
```

`handleType` here comes from `cockatiel`. See `test/Benzene.Core.Test/Cockatiel/` for the full set
(retry, exception propagation, and the outcome-aware failure-result path).

## Just retry, no cockatiel dependency

If you only want retry, don't take the `cockatiel` dependency — use `@benzenejs/resilience`, the
zero-dependency hand-rolled retry middleware:

```bash
npm install @benzenejs/resilience
```

```ts
import { useRetry } from '@benzenejs/resilience';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';

useRetry(app, { numberOfRetries: 3, initialDelayMs: 200, backoffFactor: 2.0 });
useMessageHandlers(app, ProcessOrderHandler);
```

`useRetry` retries on a thrown error and, via a `shouldRetryContext` predicate, on a failure result left on
the context. Don't stack `useRetry` and `useResiliencePipeline` for the same concern — put retry *inside*
the cockatiel policy (`retry` composed with your breaker via `wrap`) so cockatiel's strategies compose
correctly (a breaker sees the retries as one logical call). See [Resilience](../resilience.md) for the full
`RetryOptions` reference.

## Troubleshooting

- **My returned failure result isn't being acted on.** Supplying `isFailure` isn't enough on its own — the
  cockatiel policy must also be configured to handle the sentinel with
  `handleType(BenzeneFailureResultException)`. Without that, the error the middleware throws isn't a handled
  outcome, so no strategy fires.
- **My circuit breaker never trips (or resets every message).** You're building the policy per message.
  Construct the stateful policy **once** and reuse the instance across pipeline builds.
- **A `timeout` policy fires but the handler keeps running.** Expected — see the
  [timeout caveat](#timeout-caveat). The seam carries no cancellation token, so `timeout` bounds the wait,
  not the work.
- **`BrokenCircuitError` / `TaskCancelledError` reaches my error handler.** Those are cockatiel's real
  errors (breaker open, timeout elapsed) and propagate by design — only the internal
  `BenzeneFailureResultException` sentinel is swallowed. Handle them with a `fallback` policy or your
  pipeline's exception handler.

## See also

- [Resilience](../resilience.md) — Benzene's own retry-with-backoff middleware and the full cockatiel
  reference this cookbook draws on.
- [Handling SQS Message Failures](handling-sqs-failures.md) — the transport whose redelivery pairs with a
  resilience policy on the inbound pipeline.
- [Idempotency](idempotency.md) — de-duplicating the redeliveries a retry/redrive can produce.
- [Middleware](../middleware.md) — pipeline ordering and how a middleware wraps everything after it.
- [Clients](../clients.md) — the outbound routing `useResiliencePipeline` wraps in Step 4.
- [cockatiel documentation](https://github.com/connor4312/cockatiel) — the strategy catalogue.
</content>
