# Message Results

Every [message handler](message-handlers.md) returns its outcome wrapped in an `IBenzeneResultOf<T>` (or
`IBenzeneResult` for handlers with no payload) instead of throwing for expected failure cases. The
result carries a status, a success flag, the payload (on success), and error messages (on failure).
Build one with the `BenzeneResult` factory (`@benzene/results`) — you should not need to implement
`IBenzeneResultOf<T>` yourself.

> **Naming note.** C# `IBenzeneResult<T>` becomes `IBenzeneResultOf<T>` (TypeScript can't reuse the
> `IBenzeneResult` name at a different arity the way C# overloads it), and the C# `Void` "no payload"
> marker becomes `VoidResult` (`void` is a reserved word). See the README
> [Porting conventions](../README.md#porting-conventions).

## `IBenzeneResult` / `IBenzeneResultOf<T>`

Defined in `@benzene/abstractions`:

```ts
export interface IBenzeneResult {
  readonly status: string;
  readonly isSuccessful: boolean;
  readonly payloadAsObject: unknown;
  readonly errors: string[];
}

export interface IBenzeneResultOf<T> extends IBenzeneResult {
  readonly payload: T;
}
```

`status` is a plain string (see [`BenzeneResultStatus`](#benzeneresultstatus) below) — not a TypeScript
`enum` — which is what lets transport-specific status mappers (HTTP status codes, SQS
batch-item-failure, ...) key off it without a hard dependency on `@benzene/results` itself. A handler
with no meaningful payload returns `IBenzeneResultOf<VoidResult>`, which the factory fills in for you.

## `BenzeneResult` factory

Factory functions on `BenzeneResult` (`@benzene/results`). The C# generic/non-generic overload pairs
(`Ok()` / `Ok<T>(payload)`) collapse into a single function with an **optional** payload that defaults to
`VoidResult`, and the method names are **camelCase** (`BenzeneResult.ok(x)`, not `.Ok(x)`):

```ts
import { BenzeneResult } from '@benzene/results';

BenzeneResult.ok(new OrderDto());        // BenzeneResult.ok<OrderDto>() also valid (VoidResult payload)
BenzeneResult.created(new OrderDto());
BenzeneResult.accepted(new OrderDto());  // accepted() with no payload is valid too
BenzeneResult.updated(new OrderDto());
BenzeneResult.deleted(new OrderDto());
BenzeneResult.ignored<OrderDto>();

BenzeneResult.notFound<OrderDto>('Order 123 not found');
BenzeneResult.badRequest<OrderDto>('Invalid request');
BenzeneResult.validationError<OrderDto>('Name is required');
BenzeneResult.forbidden<OrderDto>();
BenzeneResult.unauthorized<OrderDto>();
BenzeneResult.serviceUnavailable<OrderDto>();
BenzeneResult.tooManyRequests<OrderDto>();
BenzeneResult.unexpectedError<OrderDto>('Something went wrong');
```

The success-style factories (`ok`, `created`, `accepted`, `updated`, `deleted`, `ignored`) produce
`isSuccessful === true`. The error-style factories (`notFound`, `badRequest`, `validationError`,
`forbidden`, `unauthorized`, `serviceUnavailable`, `tooManyRequests`, `unexpectedError`) accept
`...errors: string[]` and produce `isSuccessful === false`.

There's also a lower-level escape hatch for a custom status string that isn't one of the built-in
factories:

```ts
BenzeneResult.set(status, payload, isSuccessful);   // custom status + payload
BenzeneResult.setErrors(status, ...errors);         // custom status + error messages
```

`set`/`setErrors` are what the routing layer uses internally — `MessageRouter<TContext>` calls
`BenzeneResult.setErrors('validation-error', 'Topic is missing')` when a message has no topic, and
`setErrors('not-found', ...)` when no handler matches the topic (see
[Message Handlers](message-handlers.md)). When you don't pass `isSuccessful`, `set` derives it from the
status via `BenzeneResultStatus.isSuccess(status)`.

> **No `Is*()` / `.as<T>()` extension helpers.** The C# `BenzeneResultExtensions` (`.IsOk()`,
> `.IsNotFound()`, `.As<TOutput>()`, `HttpStatusCode.Convert()`) have no port yet. To classify a result
> in TypeScript, compare its `status` against `BenzeneResultStatus` or use the classification helpers
> below.

## `BenzeneResultStatus`

An object of string constants plus classification helpers (`@benzene/results`), **not** a TypeScript
`enum`:

```ts
export const BenzeneResultStatus = {
  accepted: 'accepted',
  ok: 'ok',
  created: 'created',
  updated: 'updated',
  deleted: 'deleted',
  ignored: 'ignored',
  notFound: 'not-found',
  badRequest: 'bad-request',
  validationError: 'validation-error',
  serviceUnavailable: 'service-unavailable',
  notImplemented: 'not-implemented',
  unexpectedError: 'unexpected-error',
  conflict: 'conflict',
  forbidden: 'forbidden',
  unauthorized: 'unauthorized',
  tooManyRequests: 'too-many-requests',
  timeout: 'timeout',

  isSuccess(status: string | undefined): boolean;   // ok/created/accepted/updated/deleted/ignored
  isFailure(status: string | undefined): boolean;   // every non-success known status
  isKnown(status: string | undefined): boolean;     // isSuccess || isFailure
  isTransient(status: string | undefined): boolean; // service-unavailable/too-many-requests/timeout
} as const;
```

The string **values** are the normative cross-language wire vocabulary — lowercase-kebab-case and
case-sensitive (`ok`, `not-found`, `validation-error`), identical to the .NET constants — so a
TypeScript service and a .NET service (or a mesh aggregator) reading each other's responses classify
statuses identically. The `isTransient` helper is the useful one when deciding whether a failure is worth
retrying (a `503`/`429`/timeout) versus a permanent business failure (a `404`/`422`).

## Transport mapping

<a id="transport-mapping"></a>

### HTTP

`@benzene/http`'s `DefaultHttpStatusCodeMapper` (`IHttpStatusCodeMapper`) maps every
`BenzeneResultStatus` value onto an HTTP status code; unrecognized or `undefined` statuses default to
`500`:

| Status | HTTP code |
|---|---|
| `ok`, `ignored` | 200 |
| `created` | 201 |
| `accepted` | 202 |
| `updated`, `deleted` | 204 |
| `bad-request` | 400 |
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `not-found` | 404 |
| `conflict` | 409 |
| `validation-error` | 422 |
| `too-many-requests` | 429 |
| `unexpected-error` (or anything unmapped) | 500 |
| `not-implemented` | 501 |
| `service-unavailable` | 503 |
| `timeout` | 504 |

`HttpStatusCodeResponseHandler<TContext>` applies this mapping to the HTTP response. On success, the
response renderer (see [Message Handlers](message-handlers.md#response-handling)) serializes the
`payload`; on failure, `DefaultResponsePayloadMapper<TContext>` serializes an `ErrorPayload` instead — an
RFC 7807-style body carrying `{ status, detail }`, where `detail` is the result's `errors` joined with
`", "`. So a `BenzeneResult.notFound<OrderDto>('Order 123 not found')` becomes an HTTP `404` with a JSON
body describing the error, not the (empty) `OrderDto` payload.

### Async/event transports — settlement (ack/nack/retry)

For queues, streams, and event triggers there is no synchronous HTTP status to return to a caller;
instead the result's `isSuccessful` flag decides whether the message is **settled** (acknowledged) or
**redelivered** (left for retry). Each transport's result-setter records the outcome on the context's
`messageResult`, and the transport's application reads that back to decide how to settle. Because a
redelivered message re-runs the handler, **any handler on a retrying transport must be idempotent** — see
the [cookbooks](cookbooks/README.md).

Two representative examples, verified against the port's source:

- **AWS SQS** (`@benzene/aws-lambda-sqs`) — batch-based. `SqsApplication` runs each record in the batch,
  and reports every record whose handler returned `isSuccessful === false`, or that threw, back to Lambda
  as an `SQSBatchResponse.batchItemFailures` entry — so SQS redrives (or dead-letters, per your redrive
  policy) only those records; successfully-handled records in the same batch are not reprocessed.
  Configurable via `SqsOptions.batchFailureMode` (default `SqsBatchFailureMode.PartialBatchFailure`;
  `FailWholeBatch` throws `SqsBatchProcessingException` on any failure so SQS retries the whole batch).
  Partial-batch mode requires `ReportBatchItemFailures` on the event source mapping's
  `FunctionResponseTypes`.
- **AWS SNS** (`@benzene/aws-lambda-sns`) — one notification per invocation, no per-record ack API, so
  settlement rides on whether the invocation throws. `SnsMessageMessageHandlerResultSetter` records the result;
  `SnsApplication` then consults `SnsOptions`. Both flags are **opt-in, defaulting to `false`**:
  - `raiseOnFailureStatus` (default `false`) — when `true`, a non-exception failure result is escalated
    into a thrown `SnsMessageProcessingException`, so SNS's subscription retry/redrive applies (the same
    at-least-once treatment a thrown exception gets). Left `false`, a failure result is accepted with no
    retry — appropriate when a failure reflects a permanent business-logic failure retrying won't fix.
  - `catchExceptions` (default `false`) — when `true`, an unhandled handler exception is caught and
    logged and the invocation reports success (no retry) instead of cascading out. Left `false`, an
    exception cascades so SNS's own retry policy applies.

> **Port note.** The .NET `SnsOptions.RaiseOnFailureStatus` defaults to `true`; the TypeScript port keeps
> both `SnsOptions` flags additive and `false` by default, preserving the pre-settlement behavior. Set
> `raiseOnFailureStatus = true` explicitly if you want a failure result to trigger SNS retries. Other
> queue/stream transports (`@benzene/azure-function-service-bus`, `@benzene/azure-function-kafka`, ...)
> expose their own equivalent options — check each package's `*Options` class for its exact default.

## See also

- [Message Handlers](message-handlers.md) — how handlers produce `IBenzeneResultOf<T>` and how the
  router / response-handling pipeline consumes it.
- [Middleware](middleware.md) — the pipeline mechanism handlers run inside, and the result middleware
  sets on the context.
- [Validation](validation.md) — how a validation-failure result short-circuits before a handler runs.
