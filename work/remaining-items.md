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

1. **Point `latest` at `0.1.0-beta.2` on the 25 August packages.** npm sets `latest` on a package's
   first publish, so the 104 packages created by this release resolve `0.1.0-beta.2` with no tag.
   The 25 published in August (`@benzenejs/abstractions*`, `ajv`, `auth-*`, `avro`, `aws-lambda*`,
   `aws-sqs*`, `azure-cosmos-db`) still have `latest` = `0.1.0-beta.1`, the build whose Lambda
   bindings can acknowledge and lose a returned failure. A maintainer, logged in with two-factor,
   runs `npm dist-tag add <pkg>@0.1.0-beta.2 latest` for each (and may `npm deprecate` the
   `0.1.0-beta.1` versions).
2. **Move publishing off `NPM_TOKEN` before January 2027,** when npm plans to stop bypass-2FA tokens
   publishing directly. Register a trusted publisher per package (`npm trust github <pkg> --repo
   daniellepelley/benzene-typescript --file release.yml --allow-publish`), then change `release.yml`
   so it no longer requires the `NPM_TOKEN` secret, and delete the secret. A package added later
   needs its first version through staged publishing or a token, since a trusted publisher can only
   be registered on a package that exists.

