# The npm release is half-published, and the error message hid it

**Status: the workflow is fixed and the decision is taken — finish `0.1.0-beta.1`. What remains is
one maintainer action (the `NPM_TOKEN` secret) and a workflow re-run.**

## What is actually on npm

`0.1.0-beta.1` was published on 2026-08-14 and **stopped partway through**. npm publishes
workspaces alphabetically, and the run died at `@benzenejs/azure-cosmos-db`:

| | Count | Examples |
|---|---|---|
| Published at `0.1.0-beta.1` | 25 | `abstractions`, `ajv`, `aws-lambda*`, `azure-cosmos-db` |
| **Not on the registry at all** | 104 | **`core`**, **`results`**, `http`, `testing`, `mesh-*`, `clients-*` |

Verified directly against the registry:

```
GET registry.npmjs.org/@benzenejs/abstractions   -> 200
GET registry.npmjs.org/@benzenejs/azure-cosmos-db -> 200
GET registry.npmjs.org/@benzenejs/core            -> 404
GET registry.npmjs.org/@benzenejs/results         -> 404
```

So `npm install @benzenejs/core` fails today. The port is not installable from npm.

## Why the re-run failed, and why the 404 was misread

The 2026-08-19 re-run failed with:

```
npm error 404 Not Found - PUT https://registry.npmjs.org/@benzenejs%2fabstractions
npm error 404  The requested resource '@benzenejs/abstractions@0.1.0-beta.1' could not be
               found or you do not have permission to access it.
```

That reads as "you may not overwrite this published version", and the first pass at this concluded
exactly that. It is **not** what happened: overwriting an existing version returns `403
EPUBLISHCONFLICT`, *"You cannot publish over the previously published versions"*. A `404` on `PUT`
for a package that a `GET` resolves publicly means the registry did not accept our identity at all.

The job log says why, one line above the failure:

```
env:
  NODE_AUTH_TOKEN: XXXXX-XXXXX-XXXXX-XXXXX
```

That is `actions/setup-node`'s literal placeholder, written into the generated `.npmrc` because the
workflow passed no token. It expected OIDC (trusted publishing) to authenticate instead — but npm
only uses OIDC for a package that already has a Trusted Publisher registered, and none had been
registered (step 2 of the old one-time setup was never done). npm fell back to the placeholder
token, and the registry answered `404`.

The version conflict was real too, and would have been the *next* failure. It was the second
blocker, not the first.

## What changed here

- **`NPM_TOKEN` is now the workflow's credential**, checked for presence before anything is built,
  with `id-token: write` still granted so trusted publishing takes over per package where it is
  registered. This is the only route that can create the 104 packages that do not exist yet: npm
  has no "pending publisher", so a package that isn't on the registry cannot be published by OIDC.
- **The publish step is resumable** — `scripts/publish-workspaces.mjs` skips whatever is already on
  the registry at the current version and publishes the rest, one at a time, backing off on npm's
  rate limit. A run that stops partway is finished by re-running the workflow. `npm publish
  --workspaces` could not do this, and that is why one interrupted publish bricked every
  subsequent attempt.
- **The preflight reports rather than blocks** on a partial release, since a partial release is now
  a recoverable state; it fails only when every package is already published at this version.
- `scripts/workspace-packages.mjs` is the single source of the package list. The preflight used to
  get it from `npm query .workspace`, which returns an empty array when `node_modules` is missing —
  so it could silently pass having checked nothing.

## The decision taken

**Finish `0.1.0-beta.1`**: publish the missing 104 at the current version rather than bumping the
whole set to `0.1.0-beta.2`.

The trade-off, recorded honestly: the 25 packages already on the registry are the 14 August build,
and `@benzenejs/abstractions` has changed since (`BenzeneError` moved into it and
`IBenzeneResult.errors` widened to `BenzeneError[]`). Consumers of `0.1.0-beta.1` will therefore get
old abstractions against new dependents. The next bump to `0.1.0-beta.2` publishes all 129 as one
consistent set and supersedes it under the `beta` tag.

## The release-notes condition — discharged in source, with one caveat

The cross-port spec plan (benzene `work/spec-simplification-plan.md`, rule 3 and decision D16) makes
settlement safe by default on every one-way binding. The port's Phase 1 settlement work (commit
`4b8d0b6`) does that: a failure result, a missing result or an uncaught error is redelivered by default
on every queue/topic/one-shot binding, every binding carries the same `atMostOnce` /
`ignoreUnmatchedTopics` knobs, and the audited per-binding record is
[`docs/capability-matrix.md`](../docs/capability-matrix.md#returned-failure-result-settlement--the-per-transport-breakdown).
The documented carve-outs are deliberate and follow .NET: the **stream** bindings (Lambda Kinesis and MSK,
the Functions Kafka and Event Hub triggers, the Kafka and Event Hub workers) acknowledge a *missing*
result and default `ignoreUnmatchedTopics` on, and the Functions **Timer** trigger acknowledges a missing
result; a failure result is redelivered on all of them.

**The caveat:** the 25 packages already on npm at `0.1.0-beta.1` — including `@benzenejs/aws-lambda*` —
are the 14 August build, with the old acknowledge-by-default behaviour. Finishing `0.1.0-beta.1` leaves
those unsafe builds as the published Lambda bindings. So if the next publish *finishes* `0.1.0-beta.1`, its
release notes must still say that **the `0.1.0-beta.1` AWS Lambda bindings can acknowledge and lose a
returned failure by default** (SNS escalation off; EventBridge, S3, Kinesis and MSK with no knob; a
missing result acknowledged) and point at `0.1.0-beta.2`. A `0.1.0-beta.2` publish of all packages
discharges it outright.

## Migration notes for the next publish (spec-0.2.0 / Phase 1)

These are breaking changes in observable behaviour or public API since `0.1.0-beta.1`; the next release
notes must list them.

- **Version selection** (core-concepts §2). An unknown version is `not-found`, never the highest
  registered version; a message with no version goes to the unversioned handler, else the one declared
  `@message(topic, { version, isDefault: true })`, else `not-found`. Opt back into the old policy with
  `HighestAvailableVersionSelector`. `IVersionSelector.select` returns `string | undefined` and takes an
  options object; `MessageHandlerDefinitionLookUp` takes an optional `IPayloadCastLookUp`.
- **One version header.** `MessageVersionHeaderNames` / `addMessageVersionHeaderNames(...names)` became
  `MessageVersionHeaderName` / `addMessageVersionHeaderName(name)`; only `benzene-version` is read (no
  `version` / `x-version` fallback), and HTTP transports now route on it.
- **Envelope over HTTP.** A processed envelope is HTTP `200` whatever its `statusCode` (the outcome is in
  the body); a malformed one is `400` problem+json. The default path moved to `/benzene/invoke`.
- **Default paths** moved under `/benzene/`: `/benzene/spec-ui`, `/benzene/mesh-ui`, the mesh dispatcher's
  `/benzene/invoke`.
- **Health.** `HealthCheckProcessor` returns `ok` with the verdict in `isHealthy`; HTTP still answers
  `503` for an unhealthy report.
- **`benzene:spec`** answers `not-implemented` for an unsupported `type`/`format`; **`benzene:ping`** is
  answered `ok` when no handler claims it.
- **EventBridge** embedded headers travel under `benzene-headers` (was `_benzeneHeaders`).
- **Validation** `errors[].field` is a JSON Pointer from every adapter (Yup and ajv changed shape); the
  gRPC rich error details carry it dotted.
- **Clients:** a response envelope without `isSuccessful` is unsuccessful; no client classifies from
  `statusCode` text any more.
- **Settlement** defaults flipped as above; the Lambda MSK handler now returns `batchItemFailures`;
  `BenzeneMessageLambdaOptions.invocationType` distinguishes `Event` (one-way: a failure throws) from
  `RequestResponse`.

## What is left to do

1. Create a granular access token on npmjs.com with **read and write** on the `@benzenejs` scope,
   and add it as the `NPM_TOKEN` repository secret.
2. Re-run the `Release` workflow. Expect it to publish 104 packages and skip 25 — and expect npm to
   rate-limit somewhere in the middle, which is what the re-run-to-resume behaviour is for.
3. Optional hardening, once every package exists: register a Trusted Publisher per package, after
   which OIDC authenticates those publishes and the token stops being exercised.
