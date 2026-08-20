# Remaining items

Live remainders extracted from actioned plans when they were archived. Each item names the archived
doc it came from; when an item is done, delete it here (and if this file empties, delete it too).

## From `work/archive/typed-outbound-responses.md` (Option A shipped 2026-08; these stayed open)

1. **Standalone-client typed wiring.** The shipped cut made the *routed* send path
   (`sendAsync<TRequest, TResponse>` via `DefaultBenzeneMessageSender`) return typed responses for
   in-process routes. The standalone `IBenzeneMessageClient` path was not wired: there is no
   standalone in-process client in `src/Benzene.Clients.InProcess/`, so the "generic-context
   clients" half of the audit line is still open for response-bearing transports. The envelope +
   `asBenzeneResult` mechanism it would reuse already exists in `@benzenejs/clients`.

2. **Error-payload bodies on failure.** `asBenzeneResult<TResponse>` currently returns a
   payload-less failure result on a failure status (see the comment "the problem document is not
   surfaced in this cut" in `src/Benzene.Clients/Common/ClientResultExtensions.ts`). Decide whether
   to deserialize the error body (e.g. into an `ErrorPayload` / problem document) and attach it, as
   .NET's `AsBenzeneResult` can, or keep failures payload-less permanently.

Context: Option B (a runtime `responseType` token for validated/class-revived responses) was
considered and deliberately deferred in the archived design note (§5); the `SchemaCasters` seam can
layer it on later without redesign.
