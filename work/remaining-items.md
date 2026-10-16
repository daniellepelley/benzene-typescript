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

## From `work/archive/npm-release-state.md` (`0.1.0-beta.2` published 2026-10-15)

1. **Move publishing off `NPM_TOKEN` before January 2027,** when npm plans to stop bypass-2FA tokens
   publishing directly. The repository side is done: `release.yml` no longer requires the secret
   (npm tries trusted publishing first, and without a token a release that adds a package stops and
   names it), and `scripts/trust-publishers.mjs` registers `release.yml` as every package's trusted
   publisher. Left, for a maintainer with 2FA (docs/publishing.md, "Registering the trusted
   publishers"): run the script (two passes of the 5-minute 2FA window for 130 packages), confirm
   the next release publishes over OIDC, then delete the `NPM_TOKEN` secret.

