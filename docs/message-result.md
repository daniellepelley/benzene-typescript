# Message Results

Every [message handler](message-handlers.md) returns its outcome wrapped in an `IBenzeneResultOf<T>` (or
`IBenzeneResult` for handlers with no payload) instead of throwing for expected failure cases. The
result carries a status, a success flag, the payload (on success), and error messages (on failure).
Build one with the `BenzeneResult` factory (`@benzenejs/results`) — you should not need to implement
`IBenzeneResultOf<T>` yourself.

> **Naming note.** C# `IBenzeneResult<T>` becomes `IBenzeneResultOf<T>` (TypeScript can't reuse the
> `IBenzeneResult` name at a different arity the way C# overloads it), and the C# `Void` "no payload"
> marker becomes `VoidResult` (`void` is a reserved word). See the README
> [Porting conventions](../README.md#porting-conventions).

## `IBenzeneResult` / `IBenzeneResultOf<T>`

Defined in `@benzenejs/abstractions`:

```ts
export interface IBenzeneResult {
  readonly status: string;
  readonly isSuccessful: boolean;
  readonly payloadAsObject: unknown;
  readonly errors: BenzeneError[];
}

export interface BenzeneError {
  message: string;
  field?: string; // the producer's property path, when it has one
  code?: string;  // the producer's own rule identifier, emitted verbatim
}

export interface IBenzeneResultOf<T> extends IBenzeneResult {
  readonly payload: T;
}
```

`status` is a plain string (see [`BenzeneResultStatus`](#benzeneresultstatus) below) — not a TypeScript
`enum` — which is what lets transport-specific status mappers (HTTP status codes, SQS
batch-item-failure, ...) key off it without a hard dependency on `@benzenejs/results` itself. A handler
with no meaningful payload returns `IBenzeneResultOf<VoidResult>`, which the factory fills in for you.

## `BenzeneResult` factory

Factory functions on `BenzeneResult` (`@benzenejs/results`). The C# generic/non-generic overload pairs
(`Ok()` / `Ok<T>(payload)`) collapse into a single function with an **optional** payload that defaults to
`VoidResult`, and the method names are **camelCase** (`BenzeneResult.ok(x)`, not `.Ok(x)`):

```ts
import { BenzeneResult } from '@benzenejs/results';

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
`...errors: (string | BenzeneError)[]` and produce `isSuccessful === false`. A plain string becomes a
message-only error, so the common case stays a one-liner; pass a `BenzeneError` when the producer
knows the `field` the value came from and the `code` of the rule that rejected it, and both reach the
caller's problem document instead of being flattened into prose it has to parse.

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

> **No `Is*()` / `.as<T>()` extension helpers.** The C# `BenzeneResultExtensions` classification/shape
> helpers (`.IsOk()`, `.IsNotFound()`, `.As<TOutput>()`) have no port yet. To classify a result
> in TypeScript, compare its `status` against `BenzeneResultStatus` or use the classification helpers
> below. (The reverse HTTP-status-code → result mapping — C# `HttpStatusCode.Convert()` — *is* ported,
> as the free function `convertHttpStatusCode(code)` in `@benzenejs/results`.)

## `BenzeneResultStatus`

An object of string constants plus classification helpers (`@benzenejs/results`), **not** a TypeScript
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
statuses identically. This vocabulary is defined once for every language in the cross-language
[Benzene spec (wire contracts — status vocabulary)](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/wire-contracts.md);
the constants here are the TypeScript surface of it. The `isTransient` helper is the useful one when
deciding whether a failure is worth retrying (a `503`/`429`/timeout) versus a permanent business
failure (a `404`/`422`).

## RFC 9457 problem documents

Every failed result leaves the service as an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem
document, on every transport. Three pieces in `@benzenejs/results` make up the surface:

**`ProblemDetails`** — the document itself: `type`, `title`, `status`, `detail`, `instance`,
`benzeneStatus`, `errors`. Unset members are omitted from the wire rather than serialized as `null`.
Two of them repay a close read:

- `benzeneStatus` is the transport-neutral discriminator — the Benzene status string, present on every
  transport, mirroring the envelope's `statusCode`.
- `status` is the **integer HTTP** status, and only ever appears where a real HTTP response exists. It
  is filled in by `useHttpProblemDetailsStatus` (`@benzenejs/http`), which every HTTP binding registers,
  from the same `IHttpStatusCodeMapper` instance that writes the response status line — so the body and
  the status line cannot disagree. An envelope over a queue carries no `status` at all, because there is
  no HTTP response for it to agree with.

**`ProblemTypes`** — the problem-type registry, keyed by the existing status vocabulary rather than a
new taxonomy: `ProblemTypes.typeFor(status)` / `titleFor(status)` / `httpStatusFor(status)`, plus a
constant per framework status (`ProblemTypes.notFound`, ...). An application-defined status has no
registry row: `typeFor` returns `undefined` (the framework never invents a URI under `benzene.app` on
your behalf) and `httpStatusFor` falls to `500`. `ProblemTypes.from(result)` builds the document the
response mapper emits.

**`BenzeneResult.problem(document)`** — for a handler that wants to fail with a *richer* document than
the status-derived one: an application-owned `type`, an `instance`, or extension members of your own.
The document's `benzeneStatus` is required (it is what classifies the failure downstream) and the
result is always unsuccessful. The authored document is emitted verbatim, so your `type` survives
instead of being overwritten by the registry URI:

```ts
import { BenzeneResult, BenzeneResultStatus, ProblemDetails } from '@benzenejs/results';

const problem = new ProblemDetails();
problem.type = 'https://orders.example.com/problems/credit-limit-exceeded';
problem.title = 'Credit limit exceeded';
problem.detail = 'Order total 1200.00 exceeds the remaining limit of 300.00.';
problem.benzeneStatus = BenzeneResultStatus.conflict;   // required

return BenzeneResult.problem<OrderDto>(problem);        // HTTP 409 + application/problem+json
```

`detail` is the compatibility member: every reader of the pre-RFC-9457 `ErrorPayload` shape used only
that one, and keeps working unchanged.

## Transport mapping

<a id="transport-mapping"></a>

### HTTP

`@benzenejs/http`'s `DefaultHttpStatusCodeMapper` (`IHttpStatusCodeMapper`) maps every
`BenzeneResultStatus` value onto an HTTP status code — the normative mapping from
[wire-contracts.md §4.1](https://github.com/daniellepelley/Benzene/blob/main/docs/specification/wire-contracts.md),
pinned by the spec's `http-status-mapping.json` conformance fixture. A status outside the table maps by
the result's own success flag: an application-defined *successful* status becomes `200`, anything else
(including `undefined`) falls to `500`:

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
| `unexpected-error` | 500 |
| `not-implemented` | 501 |
| `service-unavailable` | 503 |
| `timeout` | 504 |

`HttpStatusCodeResponseHandler<TContext>` applies this mapping to the HTTP response. On success, the
response renderer (see [Message Handlers](message-handlers.md#response-handling)) serializes the
`payload`; on failure, `DefaultResponsePayloadMapper<TContext>` serializes an
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document instead — `{ type, title,
benzeneStatus, detail, errors }`, where `detail` is the result's `errors` joined with `", "` and `errors`
carries them individually. The Benzene status travels as `benzeneStatus`, because RFC 9457 defines
`status` as the integer HTTP code — and that member **is** filled in here, by
`useHttpProblemDetailsStatus` (see [problem documents](#rfc-9457-problem-documents) below). A
JSON-negotiated failure is served as `application/problem+json` (XML: `application/problem+xml`). So a
`BenzeneResult.notFound<OrderDto>('Order 123 not found')` becomes an HTTP `404`, `content-type:
application/problem+json`, and a body whose `status` is `404` too — not the (empty) `OrderDto` payload.

### Async/event transports — settlement (ack/nack/retry)

For queues, streams, and event triggers there is no synchronous HTTP status to return to a caller;
instead the result's `isSuccessful` flag decides whether the message is **settled** (acknowledged) or
**redelivered** (left for retry). Each transport's result-setter records the outcome on the context's
`messageResult`, and the transport's application reads that back to decide how to settle. Because a
redelivered message re-runs the handler, **any handler on a retrying transport must be idempotent** — see
the [cookbooks](cookbooks/README.md).

Two representative examples, verified against the port's source:

- **AWS SQS** (`@benzenejs/aws-lambda-sqs`) — batch-based. `SqsApplication` runs each record in the batch,
  and reports every record whose handler returned `isSuccessful === false`, or that threw, back to Lambda
  as an `SQSBatchResponse.batchItemFailures` entry — so SQS redrives (or dead-letters, per your redrive
  policy) only those records; successfully-handled records in the same batch are not reprocessed.
  Configurable via `SqsOptions.batchFailureMode` (default `SqsBatchFailureMode.PartialBatchFailure`;
  `FailWholeBatch` throws `SqsBatchProcessingException` on any failure so SQS retries the whole batch).
  Partial-batch mode requires `ReportBatchItemFailures` on the event source mapping's
  `FunctionResponseTypes`.
- **AWS SNS** (`@benzenejs/aws-lambda-sns`) — one notification per invocation, no per-record ack API, so
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
> queue/stream transports (`@benzenejs/azure-function-service-bus`, `@benzenejs/azure-function-kafka`, ...)
> expose their own equivalent options — check each package's `*Options` class for its exact default.

## See also

- [Message Handlers](message-handlers.md) — how handlers produce `IBenzeneResultOf<T>` and how the
  router / response-handling pipeline consumes it.
- [Middleware](middleware.md) — the pipeline mechanism handlers run inside, and the result middleware
  sets on the context.
- [Validation](validation.md) — how a validation-failure result short-circuits before a handler runs.
