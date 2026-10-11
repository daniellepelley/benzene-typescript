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

## Migration notes for the next publish (spec-0.3.0 / Phase 3a, one self-description)

Breaking changes in the served document and in public API; the next release notes must list them too.

- **The `benzene` spec document is the spec-0.3.0 Contract Document.** `openapi`/`info` became
  `schemaDialect: "openapi-3.0"` and `service`/`serviceVersion`/`description`; every document carries
  `contractHash` and `registrationHash`; `benzene:` topics and the `reserved` flag are gone; a handler that
  returns no payload has no `response` (was `{}`); sender definitions are `sends`, no longer `events`.
- **Outbound declarations.** New `MeshOutboundRegistry` (`@benzenejs/mesh-wire`) with
  `{ kind: 'event' | 'send' }` and `ICloudServiceBuilder.withOutbound(registry)`; `withProduces` /
  `withConsumes` are deprecated aliases that declare a send. `CloudServiceBuilder.producesDefinitions` is
  replaced by `outbound`. A topic declared both as an event and a send throws.
- **Schemas.** Zod converts to the OpenAPI 3.0 dialect (`nullable: true`, the `allOf` wrapper for a
  nullable object, `date` as a date-time string, no implicit safe-integer bounds); Joi and Yup keep
  nullability. A component-name collision now fails derivation (`ComponentNameCollisionError`) at
  start-up instead of the first registration winning; declare names with Zod `.meta({ id })`, Joi `.id()`,
  Yup `.meta({ id })` or `MapTypeJsonSchemaSource.register(type, schema, { name })`. `useSpec` adds a
  start-up check. `ISchemaBuilder.addSchema`/`addNamedSchema` take an optional `usage`.
- **Hashes.** New package `@benzenejs/codegen-core`. `MeshHashing` (mesh-contracts) is removed; the
  aggregator's drift flag and `SchemaHealthCheck` read the served `contractHash` — every TS contract hash
  changes value, and now matches the other ports'. `new SchemaHealthCheck(resolver)` (was
  `(lookUp, sources)`). `computeContractHash` lost its `topicScoped` option; `computeRegistrationHash` and
  `withRecomputedHashes` are new.
- **Codegen.** `parseContractDocument` rejects an unknown `schemaDialect` (`UnknownSchemaDialectError`) and
  ignores `benzene:` entries; `ContractDocument` lost `openapi`/`info`, gained the new fields and `sends`;
  `ContractRequestResponse.reserved` and `ContractReservedTopics` are removed; `includeReserved` /
  `--include-reserved` are removed; an absent response is generated as `void`. Regenerate every client —
  every embedded hash changes once.
- **HTTP.** `IHttpEndpointDefinition` gained an optional `version`; a bodyless request is now populated
  from its enrichers (query string, route parameters, mapped headers) instead of staying `{}`.

## Migration notes for the next publish (spec-0.4.0 / Phase 3b, the Contract Document is the register body)

Breaking changes on the mesh wire and in public API (pre-1.0, no compatibility shims); the next release
notes must list them too.

- **No `benzene:mesh`, no ServiceDescriptor.** The reserved `benzene:mesh` topic, `BenzeneTopic.mesh`,
  `MeshTopics.descriptor`, `useMeshDescriptor`, `MeshServiceDescriptor`/`MeshTopicDescriptor`,
  `MeshDescriptorFactory`, `MeshDescriptorHashing` (`descriptorHash`), `IMeshSchemaProvider`/
  `NoMeshSchemaProvider`/`MapMeshSchemaProvider` and `ValidationMeshSchemaProvider` are removed from
  `@benzenejs/mesh-wire`. A service's self-description is its Contract Document at `benzene:spec`; read that
  (or `GET /benzene/spec`) instead. `MeshPlacement`/`MeshProfile` stay (in `MeshRegistration.ts`).
  `MeshServiceInfo` is `(service, serviceVersion?, instanceId?)` — the `binding` and `placement` parameters
  are gone.
- **Registration.** The `benzene:mesh:register` body is the Contract Document `benzene:spec` serves, byte for
  byte, with `runtime: "typescript"` (was `"node"`), `placement`, `profile` and `degraded` (member names
  `requests`/`events`/`sends`, was `registry`/`outbound-registry`); no `instanceId`, `binding`, `topics` or
  `produces`. New in `@benzenejs/schema-openapi`: `IServiceDeploymentInfo`/`setServiceDeploymentInfo`,
  `ContractDocumentRuntime`, `deriveContractDocument`. `IApplicationInfo` gains optional `versionScheme`
  (`setApplicationInfo(..., versionScheme?)`), carried onto the document. Every served document now carries
  `runtime`, and `degraded: ["events", "sends"]` when no outbound registry or event/send feed is registered —
  register a `MeshOutboundRegistry` (even empty) to assert "none".
- **Heartbeat.** `MeshHeartbeat` is `{ service, serviceVersion?, instanceId, registrationHash, sentAt, health }`:
  `descriptorHash` → `registrationHash`, `serviceVersion` added, `sentAt` is an ISO-8601 string (was epoch ms)
  — the .NET and Go collectors parse it as a timestamp.
- **Traces.** `HttpMeshTraceExporter` sends `startedAt` as ISO-8601 (was epoch ms, which the .NET and Go
  collectors could not parse). `MeshTraceEvent.startedAt` stays epoch ms in memory; new `MeshTime` converts.
- **Cloud service.** `useBenzeneCloudService` answers `benzene:spec` over `/benzene/invoke` as well as
  `GET /benzene/spec` (then R6; R5 since Phase 4), registers at host boot through a `cloud-service-registration` start-up check (or the
  first invocation), and no longer intercepts `benzene:mesh`. `withServiceVersion(version, versionScheme?)` now
  reaches the document (it only reached the descriptor before). `withPlacement` takes the same arguments but
  stores a `ServicePlacement`. An empty `withOutbound(new MeshOutboundRegistry())` asserts "no events, no
  sends". `CloudServiceDescriptorSource` → `CloudServiceContractDocumentSource`;
  `CloudServiceProfileReport.toMeshProfile()` → `toProfile()`; `MeshAnnouncer` takes the document source
  and `ensureStarted()` takes no argument.
- **Probe.** `CloudServiceProbe` evidences R6 (R5 since Phase 4) with a `benzene:spec` envelope (was `benzene:mesh`) and reads R2
  from the document's `requests`.
- **Collector.** `RegisterMessageHandler` takes a `MeshRegistration` (the Contract Document as received): only
  `service` is required; providers are `events` ∪ `sends`, consumers `requests`; `benzene:` entries ignored; an
  absent or `degraded` member is unknown (no edges, no undeclared-edge drift). Read models: `ServiceSummary`/
  `ServiceView.binding` → `transports`; `InstanceView.descriptorHash` → `registrationHash` (+ `serviceVersion`);
  `ServiceView.descriptor` keeps its name and holds the registration. Trace `startedAt` and issue
  `firstSeen`/`lastSeen` ingest as ISO-8601 or epoch ms. A legacy `topics`/`produces` body is not read.
- **Codegen.** The descriptor-path client generator is removed from `@benzenejs/codegen-client`:
  `buildBenzeneClient`, `generateBenzeneClientSource`, `BenzeneClientOptions`, `JsonSchema`/`asJsonSchema`,
  the `TypeScriptTypeName` and `TypeScriptPayloadBuilder` helpers. Generate from the Contract Document
  (`buildMessageClientSdk` / `buildAtomicClientSdk`) — read it from `GET /benzene/spec` for a live service.
- **AsyncAPI.** The `asyncapi` document now includes the `MeshOutboundRegistry` declarations: events as `send`
  operations on their own channels, sends as `send` operations on the target's channel with a `reply` when a
  response is declared.
- **Example.** `examples/mesh-service` serves its Contract Document through `useSpec`; `/benzene/descriptor`
  and `buildDescriptor`/`buildBenzeneSpec` are gone (`useOrderService` replaces them).

## Migration notes for the next publish (spec-0.5.0 / Phase 4, the profile)

Breaking changes in public API and in the served `profile` field (pre-1.0, no compatibility shims); the next
release notes must list them too.

- **The Cloud Service Profile is R1–R5 and R7.** R6 and R8 are gone and their ids are not reused: they are now
  the meshed-service claim's M1 (registration, heartbeats, traces) and M2 (trace context join and propagation,
  mesh.md §7.1). The Contract Document's `profile.missing` lists R1–R5/R7 ids only, so a service without a
  collector, or with `withoutMesh()`, now serves `{ "name": "cloud-service" }` (it served `missing: ["R6"]` /
  `["R6", "R8"]`). R5 now includes answering `benzene:spec` wherever the transport carries a reply.
- **Self-check.** `CloudServiceProfileReport.requirements` holds R1–R5 and R7; `missing`, `isConformant` and
  `toProfile()` are about those alone. New `CloudServiceProfileReport.mesh` (`MeshedServiceReport`: M1 and M2,
  `missing`, `isMeshed`, `profileConformant`) and `CloudServiceProfileReport.isMeshed` (the profile and M1 and
  M2). The constructor takes the mesh report as an optional second argument. M2 is now reported missing when no
  collector and no trace exporter is configured (the trace middleware is not wired then); R8 used to read only
  `withoutMesh()`.
- **Probe.** `CloudServiceProbeReport.requirements` holds R1–R5 and R7; R5 now needs both `GET /benzene/spec`
  and the `benzene:spec` topic over `/benzene/invoke` (the latter was R6). New `CloudServiceProbeReport.mesh`
  holds M1 and M2, always `Inconclusive`; `notSatisfied`, `inconclusive` and `isFullyConformant` cover the
  profile only, so `isFullyConformant` can now be true.
- **Trace context (M2).** New `useMeshTraceContext` (`@benzenejs/mesh-wire`): on an outbound route it forwards
  `traceparent` and `tracestate` from `MeshSpan.current` on sends and published events. `MeshSpan` gains an
  optional third constructor argument, `traceState`, which `useMeshTrace` fills from a joined caller.
- **UI middleware lifetimes.** `SpecUiMiddleware`, `MeshUiMiddleware` and `MeshSpecUiMiddleware` are registered
  scoped (were singleton, which captured the scoped request/response adapters). `SpecUiPage.getHtml`,
  `MeshUiPage.getHtml` and `MeshSpecUiPage.getHtml` memoize the injected page.
- **Example.** `examples/k8s-mesh` declares its sends (`withOutbound`) and no longer reports a guessed
  `placement.region` (`in-cluster`).

## What is left to do

1. Create a granular access token on npmjs.com with **read and write** on the `@benzenejs` scope,
   and add it as the `NPM_TOKEN` repository secret.
2. Re-run the `Release` workflow. Expect it to publish 104 packages and skip 25 — and expect npm to
   rate-limit somewhere in the middle, which is what the re-run-to-resume behaviour is for.
3. Optional hardening, once every package exists: register a Trusted Publisher per package, after
   which OIDC authenticates those publishes and the token stops being exercised.
