# Design note: typed outbound responses (the `TResponse` question)

Status: **implemented (in-process cut, Option A)** · Scope: `@benzenejs/clients` + `@benzenejs/clients-in-process`

> Implemented: `asBenzeneResult<TResponse>` (reusing the existing `BenzeneMessageClientResponse` envelope),
> the envelope-aware `DefaultBenzeneMessageSender`, and the in-process converter now returns the handler's
> typed response. HTTP already had typed responses; the standalone-client wiring (open question 1) and
> error-payload bodies (open question 2) remain as written below.

This note specs how to give the outbound send path a real `TResponse` — the change that would let
`IBenzeneMessageSender.sendAsync<TRequest, TResponse>` and the standalone `IBenzeneMessageClient` return a
typed response instead of always `VoidResult`. It is the one design decision behind the two remaining
TypeScript partials in the capability audit (in-process Void-only responses; generic-context clients).

## 1. The problem, precisely

The audit calls this "`TResponse` type erasure," which is true but broader than the actual gap. Pinning it
down:

- `sendAsync<TRequest, TResponse>(topic, request, headers)` — `TResponse` is a **compile-time-only** type
  parameter. At runtime the send path has nothing that says what `TResponse` is.
- `.NET` recovers the response type with `typeof(TResponse)` (reflection) and deserializes the response body
  into it. TypeScript has no runtime equivalent.

But "no runtime type" does **not** mean "no typed response." For a plain-DTO response — which is what every
Benzene payload is — `serializer.deserialize<TResponse>(body) as TResponse` (i.e. `JSON.parse` + a structural
cast) recovers the value with no runtime type needed. **The HTTP outbound client already does exactly this**
(`HttpContextConverter.mapResponseAsync`: `this.serializer.deserialize<TResponse>(body)`).

So the gap is not universal. Breaking it down by transport:

| Transport | Has a response body? | Typed response today | Real gap? |
|---|---|---|---|
| HTTP | yes (sync) | **yes** — `JSON.parse` into `TResponse` | none |
| In-process | **yes** — dispatch returns a `BenzeneMessage` envelope with a serialized `body` | no — collapsed to `VoidResult` | **yes, this is the fixable one** |
| SQS / SNS / EventBridge / Service Bus / Event Hub / Event Grid | **no** — fire-and-forget ack | `VoidResult` | none — Void is correct, `.NET` returns Void too |

**Conclusion:** the only place a typed response is thrown away is **in-process**. The queue transports are
Void by nature, not by limitation. The fix is to stop discarding the in-process response, using the same
`JSON.parse`-into-`TResponse` mechanism HTTP already uses.

## 2. Why in-process currently returns `VoidResult`

The in-process dispatch *has* the answer in hand:

- `InProcessClientMiddleware` dispatches the request and sets `context.response` to an
  `IBenzeneMessageResponse` — `{ statusCode: string; headers; body: string }` (the serialized response).
- `InProcessContextConverter.mapResponseAsync` then throws that away:
  ```ts
  contextIn.response = BenzeneResult.set<VoidResult>(contextOut.response.statusCode, new VoidResult());
  ```

The architectural reason it collapses here: `OutboundContext` is **non-generic** and the converter's
`mapResponseAsync` has no `TResponse`. It runs *inside* the pipeline, below the one place `TResponse` is
still in scope — `DefaultBenzeneMessageSender.sendAsync<TRequest, TResponse>`, the generic method at the top
of the call. So the body is deserialized (thrown away) before the frame that knows the type ever sees it.

## 3. The design

Thread the **raw response envelope** up to the sender, and deserialize there — the one frame that still has
`TResponse`.

### 3.1 Port the envelope (`@benzenejs/clients`)

Port `Benzene.Clients.BenzeneMessageClientResponse` — a raw, un-deserialized response:

```ts
export class BenzeneMessageClientResponse {
  constructor(
    readonly statusCode: string,
    readonly body: string | undefined,
    readonly headers: Record<string, string> = {},
  ) {}
}
```

### 3.2 Port `asBenzeneResult` (the deferred `ClientResultExtensions` overload)

The deserialize-into-`TResponse` step, currently deferred (see the note in `Common/ClientResultExtensions.ts`):

```ts
// @benzenejs/clients/Common/ClientResultExtensions.ts
export function asBenzeneResult<TResponse>(
  response: BenzeneMessageClientResponse,
  serializer: ISerializer,
): IBenzeneResultOf<TResponse> {
  const status = BenzeneResultHttpMapper.mapBenzeneResultStatus(response.statusCode);
  if (isSuccess(status)) {
    const payload = response.body === undefined ? undefined : serializer.deserialize<TResponse>(response.body);
    return BenzeneResult.set<TResponse>(status, payload as TResponse, true);
  }
  // Failure: surface the error payload if present, else a payload-less failure (mirrors .NET).
  return BenzeneResult.set<TResponse>(status, undefined, false);
}
```

It tolerates both a Benzene result status (`"ok"`, `"not-found"`) and a numeric HTTP code, exactly as the
`.NET` `AsBenzeneResult` does.

### 3.3 Make the sender envelope-aware (backward compatible)

`DefaultBenzeneMessageSender.sendAsync<TRequest, TResponse>` accepts **either** shape on `context.response`,
so nothing that already sets an `IBenzeneResult` changes:

```ts
await pipeline.handleAsync(context, this.serviceResolver);

if (context.response instanceof BenzeneMessageClientResponse) {
  return asBenzeneResult<TResponse>(context.response, this.serializer);   // NEW: response-bearing transports
}
if (isBenzeneResult(context.response)) {
  return context.response as IBenzeneResultOf<TResponse>;                 // unchanged: Void transports
}
throw new OutboundResponseTypeMismatchException(topic);
```

### 3.4 Switch in-process to the envelope

`InProcessContextConverter.mapResponseAsync` stops collapsing to `VoidResult`:

```ts
mapResponseAsync(contextIn, contextOut): Promise<void> {
  const r = contextOut.response; // IBenzeneMessageResponse
  contextIn.response = new BenzeneMessageClientResponse(r.statusCode, r.body, r.headers);
  return Promise.resolve();
}
```

That's the whole behavioural change: the serialized handler response now round-trips into the caller's
`TResponse` instead of being dropped. **The six queue converters are untouched** — they keep setting
`VoidResult`, and the sender's `isBenzeneResult` branch keeps returning it verbatim.

## 4. The one genuine divergence to document

`deserialize<TResponse>(body)` is `JSON.parse` + a structural cast. Consequences, both worth a porting-table
row:

1. **No runtime validation.** A body that doesn't match `TResponse` yields a mis-shaped object silently
   rather than an error. (`.NET`'s field-mapping deserializer is only marginally stricter.) A caller that
   wants validation composes a validator (`@benzenejs/zod` / `ajv`) on the response — the seam already exists.
2. **No class-instance revival.** `JSON.parse` produces a plain object; methods on a response class are not
   restored. Benzene payloads are DTOs, so this matches real usage.

## 5. Recommended vs. deferred

- **Recommend now — Option A (structural):** §3 above. No public API change, non-breaking, unblocks
  in-process typed responses and gives the standalone `IBenzeneMessageClient` its typed-response half.
  Idiomatic TS (this is how TS developers deserialize), and it reuses the exact mechanism HTTP already ships.
- **Defer — Option B (runtime type token):** add an optional `responseType` (a constructor, or a registered
  `SchemaCasters`/schema) to `sendAsync` / the client for callers who need class revival or validated
  responses. More faithful to `.NET`'s `typeof(TResponse)`, but it is an API-surface change and the caster
  seam (`SchemaCasters` in `@benzenejs/core-versioning`) can layer it on later without redesign. Not needed to
  close the audit gaps.

## 6. What this closes

- **Core engine partial → resolved for in-process.** In-process stops being Void-only; the remaining
  "Void-only" reading was really just this converter. Queue transports stay Void (correct).
- **Outbound clients partial → generic-context clients unblocked.** With the envelope + `asBenzeneResult`,
  the standalone `IBenzeneMessageClient` / generic `*ContextConverter<TRequest, TResponse>` can return typed
  responses for the response-bearing transports (HTTP, in-process). Queue standalone clients remain Void by
  nature — reframe the audit line from "deferred" to "Void where there is no response body."

## 7. Work breakdown & risk

| Step | Files | Risk |
|---|---|---|
| Port `BenzeneMessageClientResponse` | `@benzenejs/clients` (+ index) | none |
| Port `asBenzeneResult<TResponse>` | `Common/ClientResultExtensions.ts` | low |
| Envelope-aware sender | `DefaultBenzeneMessageSender.ts` | **medium** — core send path; guarded by `instanceof`, so existing `IBenzeneResult` behaviour is untouched |
| In-process converter → envelope | `InProcessContextConverter.ts` | low; update its PORT DIVERGENCE note |
| Tests | in-process typed round-trip, status/error mapping, Void transports unchanged | low |
| Docs | `clients.md` overview note, README porting-table row for the structural divergence | low |

Estimated ~1 focused session. The only load-bearing change is the sender; because it dispatches on
`instanceof BenzeneMessageClientResponse` and falls back to the current `isBenzeneResult` path, every existing
transport and test keeps its behaviour, and only in-process opts into the new path.

## 8. Open questions for review

1. **Scope of the first cut** — in-process only (smallest, closes the Core-engine reading), or also wire the
   standalone `IBenzeneMessageClient` typed path (closes more of the Outbound-clients line) in the same pass?
2. **Error-payload body** — on a failure status, do we deserialize the error body into an `ErrorPayload` and
   attach it (as `.NET`'s `AsBenzeneResult` can), or keep failures payload-less as `convertStatusCode` does
   today? The former is a small addition; the latter matches current TS behaviour.
3. **Option B appetite** — is validated/class-revived response deserialization ever wanted, or is structural
   (Option A) the permanent answer for this port?
