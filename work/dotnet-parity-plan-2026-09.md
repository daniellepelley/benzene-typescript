# .NET-parity plan — TypeScript port (2026-09)

**Status: READY FOR EXECUTION — not yet started.**

## How this plan was built

Two inventory passes were prepared against the estate as of 2026-09-02/03 and are the sources for
every claim below:

1. A **benzene-dotnet change inventory** covering every functional change on `main` since the
   2026-08-20 capability-matrix baseline (commit `6efa268`; HEAD `46dd0db`): the fix rounds 5–17
   (all shipped), the settlement-consistency batch series (shipped), and the two **planned-only**
   rounds — round 18 (#292–#317) and the ergonomics round (#318–#450) — which have plan docs but
   zero implementing commits.
2. A **spec/conformance inventory** of `/home/user/Benzene` (`docs/specification/**`): all normative
   changes since 2026-08-01, the fixture add/modify log, and a byte-level diff of this repo's
   vendored fixture snapshot — **all 14 fixtures identical to canonical, SPEC_VERSION `84bf13a…`
   equal to .NET's**. Zero fixture drift.

Each candidate item was then assessed against THIS repo's `src/`/`test/` (file:line evidence cited
per item), this repo's own post-baseline commits (`git log --since=2026-08-20`), the pre-existing
gaps recorded in `docs/capability-matrix.md`, and `work/remaining-items.md`.

**⚠ Citation convention — task-number collisions.** The .NET task board reused numbers across
rounds (e.g. "#250" is Polly cancellation on the rounds-14/15 board but mesh-query cancellation on
the round-16 board). Every .NET citation below is therefore written `R<round> #<n>`; never resolve
a bare number without cross-checking the description in the round's ruling doc under
`/home/user/benzene-dotnet/work/` (or `work/archive/`).

**Honesty rule.** Items whose assessment relied on grep/spot-reads rather than a full read are
marked **[needs confirmation]** — the implementing agent's first step there is to confirm the
stated status with a red test before building anything.

**Execution conventions** (match this repo's house rules, `AGENTS.md`): read the corresponding C#
first and port it; red-test-first (port the named .NET tests to vitest); `npm run build` +
`npm test` before done; one logical change per commit; every behavioral divergence recorded in the
README "Porting conventions" table; `docs/capability-matrix.md` rows updated in the same commit as
the code they describe. Sizes: **S** (hours, one package), **M** (a day, 1–3 packages),
**L** (multi-day, cross-cutting).

---

## Verified already at parity (no work item — do not re-port)

Evidence-checked in this repo's source, not just commit messages:

| Area | .NET/spec reference | TS evidence |
|---|---|---|
| Conformance fixtures + SPEC_VERSION | canonical `docs/specification/conformance/` | all 14 files byte-identical; `test/Benzene.Core.Test/Conformance/fixtures/SPEC_VERSION` = `84bf13a…` (= .NET); own `conformance-drift-check.yml` |
| RFC 9457 problem details (spec `b732a74`) | `wire-contracts.md` §1.3/§3.1/§4.1 | `ProblemDetailsConformanceTest.test.ts`, `EnvelopeConformanceTest.test.ts`, `HttpProblemDetailsResponsePayloadMapper.ts`; TS commits `628ca88`, `be3a8a6` |
| Mesh producer/consumer role inversion (spec `d7aed44`+`f45a187`; .NET `3e59c98`) | `mesh.md` §2/§2.3/§4 | `src/Benzene.Mesh.Wire/MeshServiceDescriptor.ts:30-48` carries `produces` with the inversion documented; descriptor/collector fixtures run green |
| Reserved-topic `benzene:` prefix | spec reserved-topic rule | TS commit `4c987e9` |
| gRPC structured errors over `grpc-status-details-bin` | `wire-contracts.md` §4.2 | TS commit `409ddcc`; `src/Benzene.Grpc/RichErrorDetails.ts` (hand-rolled proto3 encode/decode, verified against protobufjs) |
| Issue-feed fixture + collector ingest fix | `mesh-issue-cases.json` | TS commit `1d108b5` |
| Vendored-fixture coverage gate ("a fixture nothing opens fails") | .NET `98e0a14`'s spirit | TS commit `819f04d`, `ConformanceCoverageTest.test.ts`. **[needs confirmation]** that the *runner* also treats an unfound key *inside* a fixture as drift, not a pass |
| Mesh UI vendored asset | `benzene-ui` build `ca9668d` | `src/Benzene.Mesh.Ui/mesh-ui.html` byte-identical to canonical; TS commit `a69940f`; own `mesh-ui-drift-check.yml` |
| OAuth2 bearer core: required no-default algorithm allowlist, JWKS + OIDC discovery, HTTPS-required default | R11 #172–#182 family | `src/Benzene.Auth.OAuth2/OAuth2BearerOptions.ts:35-84` (empty-allowlist rejection, RFC 8725 §3.1 cited), authority/jwksUri XOR, `requireHttps` default true |
| Validation status mapper consulted by validation middleware | R10 #99/#102 (WP-W) | `IValidationStatusMapper`/`DefaultValidationStatusMapper` in `src/Benzene.Abstractions.Validation/`, referenced by ALL FOUR adapters (Zod/Joi/Yup/Ajv `ValidationMiddleware.ts`). **[needs confirmation]** the mapped status actually short-circuits per adapter — port one .NET WP-W test per adapter if untested |
| Queue Storage envelope-as-message-body convention | R7-10 #80 | `src/Benzene.Clients.Azure.QueueStorage/OutboundQueueStorageContextConverter.ts:16-32` |
| EventBridge `_benzeneHeaders` embedding, both directions | spec transport binding; .NET awseventbridge convention | `src/Benzene.Clients.Aws.EventBridge/OutboundEventBridgeContextConverter.ts:22`, `src/Benzene.Aws.Lambda.EventBridge/EventBridgeMessageHeadersGetter.ts:18` |
| Lambda client `Event` invoke + `FunctionError` not swallowed | R5-6 #12/#13 | `src/Benzene.Clients.Aws.Lambda/AwsLambdaClient.ts:22-35` **[needs confirmation]** on the exact failure mapping |
| SQS self-hosted consumer: delete only explicit successes; unrouted/failed left for redrive | A1 policy | `src/Benzene.Aws.Sqs/Consumer/SqsConsumer.ts:19-20,77-111` (partial-delete failure logged, redelivery accepted) |
| Collector duration/time-range: unparseable bound = absent, never throws | R5-6 #22 | `src/Benzene.Mesh.Collector/MeshTimeRangeResolver.ts:12-16` **[needs confirmation]** for the R18 #308 checked-arithmetic edge (`'w'/'M'/'y'` overflow) |
| Avro serialization fidelity (union resolution, recursion) | R17 #278/#279, R7-10 #56–#59 | **NOT APPLICABLE (mostly)** — TS adapts `avsc` (`src/Benzene.Avro/package.json:16`) per the third-party-integration convention rather than hand-rolling a codec; union/branch resolution is avsc's. Do not port the .NET codec fixes |
| RabbitMQ `mandatory` publish (R5-6 #24) | — | **NOT APPLICABLE** — `src/Benzene.RabbitMq` is worker-only; this port ships no RabbitMQ outbound client |
| Outbox claim/lease fixes (R14-15 #253–#256, R18 #314) | — | **NOT APPLICABLE** — no outbox package, a documented deliberate divergence (`docs/capability-matrix.md:58`) |
| HMAC signing-key entropy floor (R17 #286) | — | **NOT APPLICABLE** — TS bearer auth accepts only `authority`/`jwksUri` (asymmetric via JWKS); there is no static shared-secret path to entropy-check |
| STJ NaN/Infinity default (R7-10 WP-L item) | — | **NOT APPLICABLE** — `JSON.stringify(NaN)` → `null` in JS; different problem shape, no crash to fix |
| Autofac adapter parity (R7-10 #82–#85), Roslyn diagnostics (BENZ000x), NuGet packaging (#413–#420), Mesh.Host deploy wiring | — | **NOT APPLICABLE** — dotnet-specific mechanisms |

---

## Wave 1 — safety and correctness

### W1.1 Complete the settlement contract across every transport (L)

**The single most important item in this plan.** The .NET 1.0 settlement contract (maintainer-
decided 2026-08-25) has two axes this port has only partially absorbed, and our own
`docs/capability-matrix.md:71-118` states the gap plainly.

- **.NET reference**: `work/settlement-consistency-fix-plan.md` (§1 table is the source of truth,
  §5 decision register) in `/home/user/benzene-dotnet`; Batches 1–4 commits `13a0467`, `f4638f9`,
  `99e1c41`, `15d77f4`/`422f128`; baseline-day fix `e967122` (Kafka worker). Code:
  `src/Benzene.Aws.Lambda.Core/SingleContextEscalatingApplicationBase.cs` (guard polarity
  `!= true`), `src/Benzene.Azure.Function.Core/AzureFunctionBatchApplicationBase.cs`
  (`EscalateUnestablishedOutcome` hook, overridden `false` by the Kafka/EventHub carve-outs),
  `src/Benzene.Kafka.Core` worker. Drift guard:
  `test/Benzene.Core.Test/Contract/SettlementContractDefaultsTest.cs` (pins all 18 adapters).
  Citations: Settlement Batches 1–4; A-family items R15 #227–#229 (R15 board), R17 #275,
  baseline `e967122` (A2).
- **TS current state (verified)**:
  - *Knob defaults off* (divergent from .NET `true`): SNS (`SnsOptions.raiseOnFailureStatus`),
    Azure Service Bus trigger, Azure Kafka trigger (`docs/capability-matrix.md:91-99`).
  - *No knob at all*: EventBridge, S3, AWS Kafka/MSK trigger, Azure Event Hub trigger (grep
    confirms zero `raiseOnFailureStatus`/`batchFailureMode` hits in those four packages); Kinesis
    is a per-record fan-out adaptation with no checkpoint engine (see W3.3).
  - *Polarity bug even where the knob exists*: `src/Benzene.Aws.Lambda.Sns/SnsApplication.ts:57`
    checks `context.messageResult?.isSuccessful === false` — a **null/unestablished** outcome
    (typically an unrouted message) is settled as success even with the knob on. .NET flipped
    exactly this to `!= true`.
  - *Kafka self-hosted worker*: `src/Benzene.Kafka.Core/BenzeneKafkaWorker.ts:105-135` commits
    after `handleAsync` returns without throwing — a handler that *returns* a failure result is
    committed under `commitOnlyOnSuccess`. .NET `e967122` settles a returned failure like a throw.
- **What to change** (apply the .NET §1 table, not per-adapter taste):
  1. Flip the three existing knobs' defaults to `true` (SNS, ServiceBus trigger, Azure Kafka
     trigger) — breaking behavioral change, CHANGELOG + matrix rows in the same commit.
  2. Add the escalation knob (default `true`) to EventBridge, S3, MSK trigger, Event Hub trigger.
  3. Change escalation polarity everywhere from `=== false` to `!== true` so a null result
     escalates wherever a redelivery backstop exists.
  4. Kafka worker: under `commitOnlyOnSuccess`, treat a returned failure result like a thrown
     exception (no commit; same stop/skip path per `catchHandlerExceptions`).
  5. Keep the declared carve-outs exactly as .NET/spec policy states: the self-hosted Kafka and
     Event Hub workers stay ack-on-null/at-most-once **by default** (stream transports, no
     per-record dead-letter path) — that default is a decision, already documented at
     `docs/capability-matrix.md:112-118`; do NOT flip it. Fan-in transports (Kinesis, Cosmos
     change feed) are docs-only (no per-record axis).
  6. Port the drift guard: a TS `SettlementContractDefaults.test.ts` that pins every adapter's
     default polarity + the carve-outs + the matrix text, so future edits fail loudly.
- **Acceptance**: ported vitest equivalents of the .NET Batch 1–4 tests per adapter (null result
  escalates; returned failure escalates; thrown escalates; carve-outs pinned); the new drift-guard
  test; `docs/capability-matrix.md` §"Returned-failure-result settlement" rewritten to the new
  truth (the three tables collapse mostly into "safe by default").
- **Note**: .NET's §4 records a maintainer decision to promote the settlement axes into
  `docs/specification/**` with fixtures later. When that lands, re-vendor and wire the fixtures;
  don't invent TS-local fixture shapes now. Hard rule 5 of the .NET plan applies here too: **no
  new settlement flags/options/enum values** beyond the ported knob.

### W1.2 Idempotency: claim fencing + null-result-is-not-success (M)

- **.NET reference**: `src/Benzene.Idempotency/IIdempotencyStore.cs` (claim token minted by
  `TryClaimAsync`, fenced `CompleteAsync`/`ReleaseAsync` — "a skippable fence is no fence", no
  token-less overload), `IdempotencyMiddleware.cs` (`IsSuccessful ?? false` for
  `IHasMessageResult` contexts). Citations: R5-6 #16/#17, R7-10 #31/#51 (fencing), R16 #260
  (null-result rule), R17 #272 (inclusive expiry boundary `expiresAt <= :now`).
- **TS current state (verified)**:
  - `src/Benzene.Idempotency/IIdempotencyStore.ts` + `InMemoryIdempotencyStore.ts:65-79`: no claim
    token anywhere — `completeAsync(key)`/`releaseAsync(key)` are unfenced; a worker whose claim
    expired and was reclaimed by another worker can clobber the live claim.
  - `IdempotencyMiddleware.ts:84-93` (`wasSuccessful`): a result-bearing context whose
    `messageResult` is null/undefined returns `true` → completed-without-result is recorded as
    success. .NET R16 #260 decided the opposite (release, so redelivery re-runs); no-throw==success
    stays only for result-**less** contexts.
  - Expiry boundary: `InMemoryIdempotencyStore.ts:52` (`expiresAt > now` = still live) is already
    inclusive-on-expiry and self-consistent; the .NET #272 bug was a DynamoDB read/write mismatch.
    Pin it with a boundary test (claim at exactly `expiresAt` must win).
- **What to change**: mirror the .NET store contract — `tryClaimAsync` returns a fresh opaque
  `claimToken` on a win; `completeAsync(key, claimToken, wasSuccessful)` /
  `releaseAsync(key, claimToken)` verify the token is still the live claim's and return `false`
  without writing otherwise; middleware threads the token and applies
  `messageResult?.isSuccessful !== true` → release for result-bearing contexts. Breaking store-API
  change — flag it (AGENTS.md rule), update the idempotency cookbook (`docs/cookbooks/`) which
  tells users to build DynamoDB/Redis stores against this interface.
- **Acceptance**: ported .NET tests — stale-token settle is a no-op; expired-claim reclaim then
  old-worker settle does not clobber; completed-without-result on a result-bearing context
  releases and a redelivery re-runs the handler; result-less context keeps no-throw==success;
  expiry-boundary test. Matrix idempotency row updated.

### W1.3 Cancellation/abort correctness sweep (M)

The .NET rounds spent enormous effort on two portable rules: (1) **ambient cancellation reaches
every outbound call and nested dispatch**, (2) **"is this OUR cancellation?" is decided by the
caller's own token, never by exception type** (an HTTP per-request timeout throws the same shape
without the caller's token being cancelled). TS uses `AbortSignal`; the same two rules apply.

- **.NET reference/citations**: R14-15 #225/#250, R16 #252/#256/#261-family, R17 #284/#285
  (the envelope-over-HTTP fix that made the chain work end-to-end), R10 #104
  (ASP.NET `RequestAborted` forwarded).
- **TS current state (verified)**:
  - `src/Benzene.Clients.Http/HttpClientMiddleware.ts` + `HttpSendMessageContext`: **no
    AbortSignal at all** — `fetch(request.url, {...})` is sent without a `signal`, so an outbound
    HTTP send can neither be aborted by the caller nor bounded per-request.
  - `src/Benzene.Express/*` and `src/Benzene.Http/BenzeneMessage/BenzeneMessageHttpMiddleware.ts`:
    no abort/signal anywhere — an aborted inbound HTTP request (client gone) does not propagate
    into the dispatched pipeline (the R17 #285 / R10 #104 analog).
  - `src/Benzene.Resilience/RetryMiddleware.ts:79-81`: default retry predicate is **type-based**
    (`error instanceof OperationCanceledException`) — exactly the filter class R16 #252/#256
    replaced. TS has no ambient token accessor, so the practical port is: give `RetryMiddleware`
    an optional `signal` (or read one off the context when present) and make the default predicate
    "retry anything unless *our* signal `.aborted` is true".
  - Mitigating: many packages already take `AbortSignal` (75 files — workers, mesh sources,
    `CompositeMeshFleetReadModel`), so the sweep is about the named gaps, not a from-scratch idiom.
- **What to change**: (a) add `signal?: AbortSignal` to the outbound HTTP send context and pass it
  to `fetch`; (b) wire inbound request abort (Express `req` close/abort → an `AbortSignal` on the
  context) through the BenzeneMessage envelope dispatch and hand it to handlers/outbound sends;
  (c) fix the retry default predicate as above; (d) audit the outbound client packages
  (`src/Benzene.Clients.*`) for a signal parameter on their send paths — port the R16 #261/
  R7-10 #268/#270 sweep where the AWS/Azure SDK call accepts `abortSignal`. **[needs
  confirmation]** per client package — enumerate them in the WP before coding, so the ninth
  transport isn't missed the way .NET missed Pub/Sub (R18 #311).
- **Acceptance**: vitest — aborted inbound request rejects the in-flight dispatch; outbound fetch
  receives the signal (stub fetch asserts); retry does not classify a foreign timeout-shaped error
  as "our cancellation" and DOES stop retrying when the caller's signal is aborted.
- **Out of scope**: .NET's nested `UseTimeout` classification (R7-10 #61) — this port has no
  timeout middleware; timeouts are Cockatiel's (`src/Benzene.Cockatiel`). Note it in the matrix
  row instead. Polly concurrent-attempt guard (R16 #267/R17 #288) — **[needs confirmation]**
  whether the Cockatiel bridge shares mutable context across hedged attempts; if it does, document
  the constraint rather than porting the .NET guard mechanism.

### W1.4 Codegen file-write containment (S) — R18 #292's ruling, ported NOW

R18 is planned-only in .NET, but #292 is a security finding (arbitrary file write from a fetched
spec) and this plan ports the *ruling* immediately regardless of .NET's landing state.

- **.NET reference**: `work/bug-fix-plan-round18-2026-08.md` WP-A (ruling: contain in the writer —
  full-path prefix check + reject rooted names — AND sanitize file stems);
  `src/Benzene.CodeGen.Core/CodeFileWriter.cs`. Citation: R18 #292.
- **TS current state (verified)**: `src/Benzene.CodeGen.Client/Cli.ts:160-165` does
  `join(outDir, file.fileName)` + `mkdir(dirname(target), {recursive:true})` + `writeFile` with
  **no containment check**. The document-derived stems ARE sanitized today
  (`AtomicClientSdkBuilder.ts:49,65`, `MessageClientSdkBuilder.ts:42` all pass through
  `toIdentifierSegment` → `[A-Za-z0-9_]` only, `NameFormatter.ts:19`), so a hostile `.spec.json`
  cannot currently traverse — but that safety is one refactor away from silently vanishing, and
  `--namespace` (`namespacedFileName`, `MessageClientSdkBuilder.ts:64-66`) is spliced into the
  path raw.
- **What to change**: before writing, resolve `target` and require it to be inside the resolved
  `outDir` (prefix check on the resolved absolute path + path separator; reject absolute
  `file.fileName`); apply the same check to the `--namespace` component. Keep the stem
  sanitization as the first line of defense.
- **Acceptance**: red tests first — a `GeneratedClient` with `fileName` of `../evil.ts`, an
  absolute path, and a traversal-bearing `--namespace` are all rejected without writing; the
  existing CLI tests stay green. Also assert (pin) that a document topic/serviceName containing
  `../` still yields a sanitized stem — the current behavior, now guarded by test.

### W1.5 Cache safety rules (S)

- **.NET reference/citations**: R12-13 #198 (empty-prefix invalidation throws instead of building
  pattern `"*"` — cache-wipe guard), R12-13 #201 (`null` is the ONLY cache-miss marker; empty
  string is a valid cached value), R11 #133–#147 + R18 #296's rule (a cache-side write failure
  after a successful load must not fail the operation).
- **TS current state**: `src/Benzene.Cache.Redis/RedisCacheService.ts:86-87` builds
  `prefix + '*'` with no empty/whitespace guard — an empty prefix wipes the cache (verified,
  the exact #198 shape). Miss-marker and write-failure semantics: `CacheEntry.ts` has one catch
  block — **[needs confirmation]** whether it covers the read AND write sides and whether
  `undefined` vs `null` is used consistently as the miss marker.
- **What to change**: throw on empty/whitespace prefix (both the service entry point and the
  wildcard actions — guard both ends like .NET); write the miss-marker and
  write-failure-degradation contract tests, fixing whatever they catch. The portable rule set
  (matches the Go port's documented degradation): read error = miss; write error ignored (with
  hook); load error returned and not cached; one designated miss marker that cannot collide with
  a legitimate cached value.
- **Acceptance**: ported #198/#201 tests; a stubbed store whose `set` throws does not fail
  `getOrLoad`-style reads; empty-prefix invalidation throws on both ends.

---

## Wave 2 — contract and mesh parity

### W2.1 Deterministic schema `required` ordering (S)

- **.NET reference**: `src/Benzene.Mesh.Wire/MeshSchemaGenerator.cs:167` — `required` sorted
  ordinally so the descriptor (and the contract hash) is deterministic. Citation: R5-6 #7.
- **TS current state (verified)**: schema derivation is provider-based
  (`src/Benzene.Mesh.Wire/MeshSchemaProvider.ts` — a documented divergence: no runtime
  reflection), and `MeshDescriptorFactory.ts:172` canonicalizes **object keys** only ("arrays
  keep order"). So a provider that emits `required` in property-insertion order (e.g.
  `src/Benzene.Zod/zodToJsonSchema.ts`, which emits `required`) produces a hash that differs
  from .NET's for the same contract, and can flap if the provider's order isn't stable.
- **What to change**: sort `required` ordinally at the derivation seams —
  `zodToJsonSchema.ts` and any other adapter that emits `required` — AND add a `required`-aware
  step in `MeshDescriptorFactory`'s `canonicalSchema` (sort exactly the `required` member's
  array, nothing else; other arrays keep semantic order) so provider-supplied schemas are
  normalized too.
- **Acceptance**: vitest — two zod schemas declaring the same properties in different orders
  yield identical descriptors and identical `descriptorHash`; the vendored
  `mesh-descriptor-cases.json` runner stays green.

### W2.2 `declaredSchemas` on the topic entry (M)

- **.NET reference**: commit `46f038e` ("Publish what each service declares, and make dispatch
  actually work"); `src/Benzene.Mesh.Contracts/MeshTopicEntry.cs`,
  `src/Benzene.Mesh.Aggregator/MeshAggregator.cs` (grep `DeclaredSchemas`). Paired with the
  vendored UI build `benzene-ui ca9668d` (which THIS repo already carries byte-identically —
  the UI's union-tree mismatch view renders these).
- **TS current state (verified)**: `src/Benzene.Mesh.Contracts/MeshTopicEntry.ts` and
  `src/Benzene.Mesh.Aggregator/MeshAggregator.ts` carry `schemaMismatch` only — zero
  `declaredSchemas` hits outside the vendored HTML. A TS-hosted mesh serves the mismatch view in
  its degraded fallback.
- **What to change**: port the .NET shape exactly — per-service declared request/response/message
  schema declarations on the topic entry, keyed by service name, populated **only when
  `schemaMismatch` is true**, never on reserved topics, preserved through entry rebuilds.
- **Acceptance**: ported .NET aggregator tests (mismatching services expose their declarations;
  matching topics don't carry the field; reserved topics never do); manual check that the
  vendored `mesh-ui.html` mismatch view renders the union tree against a local aggregator.
- **Spec note**: `mesh.md` does NOT specify `declaredSchemas` (confirmed in the spec inventory) —
  this is implementation parity with .NET's catalog surface, not a conformance item. Don't invent
  fixture assertions for it.

### W2.3 Mesh dispatch guard hardening (M)

- **.NET reference**: R12-13 #185–#187 (`src/Benzene.Mesh.Dispatch/HttpMeshServiceDispatcher.cs`
  and siblings): ambient token into `DispatchAsync`; dispatch failure audits `"dispatch-failed"`
  **then rethrows**; rate limiter validates target before charging + self-prunes past 512
  windows; `MaxResponseBytes` response cap (default = request cap) with audit-visible truncation;
  R16 #254 (limiter prune TOCTOU), R16 #255 (audit on the no-dispatcher path). Plus `46dd0db`-era
  guard shape recorded in the main repo (`work/archive/mesh-mismatch-and-dispatch-plan.md`):
  CSRF header (`X-Benzene-Dispatch`), fail-closed identity, payload bound, per-identity and
  per-target limits, envelope-shaped refusals (a 429 renders in the UI).
- **TS current state (verified)**: `src/Benzene.Mesh.Dispatch/MeshDispatchGate.ts` +
  `MeshDispatchOptions.ts` are the whole guard — a production on/off environment gate. No CSRF
  check, no identity, no size caps, no rate limiting, no audit, no abort propagation.
- **What to change**: port the guard set onto the TS dispatch path (`MeshDispatchGate` /
  `MeshDispatchMessageHandler` / `HttpMeshServiceDispatcher`), keeping .NET's decided shapes:
  audit-then-RETHROW (not audit-and-return — that alternative was explicitly rejected), no
  dedicated `DispatchTimeout` option (rejected — the fix is signal flow, W1.3 supplies it),
  response cap defaulting to the request cap.
- **Acceptance**: ported .NET #185–#187/#254/#255 tests; refusals are envelope-shaped so the
  vendored UI renders them.

### W2.4 Collector versioned catalog — mesh.md §2.4/§2.5, Mechanism C claim (L)

This is the one place TS is deliberately *behind the spec*, recorded as such:
`ConformanceCoverageTest.test.ts` exempts `mesh-service-version-cases.json` and
`mesh-version-order-cases.json` with "awaits a cross-port claim-or-drop decision". .NET has since
**claimed it** (R16 #251 shipped the versioned catalog). This plan claims it for TS.

- **.NET reference**: `src/Benzene.Mesh.Collector/MeshCollectorStore.cs`,
  `src/Benzene.Mesh.Contracts/MeshServiceVersion.cs`. Citations: R16 #251 (catalog keyed
  `(service, serviceVersion)`; re-registering one version doesn't evict another; `HashMatches`
  per-version), R17 #283 (any-live-version rule for observed-activity/drift), R17 #290
  (`maxVersionsPerService` eviction, default 8, evicted descriptor's edges retracted). Spec:
  `mesh.md` §2.4 (identity extrinsic — MUST NOT synthesize from per-boot values or derive from
  descriptorHash), §2.5 (declared ordering scheme from a closed set; no default; mixed schemes
  NOT ORDERABLE — reported, not guessed; `createdAtUtc` never a tiebreak), §4 (graph collapses
  versions to one node).
- **TS current state (verified)**: `serviceVersion` already travels on the wire
  (`MeshServiceDescriptor.ts:17`, `MeshServiceInfo.ts:11`, canonicalized into the hash at
  `MeshDescriptorFactory.ts:135-136`) — but `src/Benzene.Mesh.Collector/` has zero
  `serviceVersion` hits: the store keys by service name only, and there is no
  `MeshServiceVersion` type or ordering comparator.
- **What to change**: port `MeshServiceVersion` + the ordering comparators
  (integer/semver/lexicographic, closed set); key `MeshCollectorStore` by
  `(service, serviceVersion)`; per-version hash matching (same-version-different-hash = drift;
  two versions with differing hashes = healthy); the any-live-version declared-topic rule for
  drift detection; `maxVersionsPerService` eviction with edge retraction; graph still one node
  per service. Then **remove the two fixture exemptions** and wire both fixtures into runners.
- **Acceptance**: `mesh-service-version-cases.json` (144 lines) and
  `mesh-version-order-cases.json` (161 lines — includes the "10" vs "9" integer trap, rc.10 vs
  rc.9 semver, cross-scheme not-orderable) run green; ported R16 #251 / R17 #283/#290 collector
  tests; `ConformanceCoverageTest` exemption list emptied of these two.
- **Do NOT decide here** (spec-owner `[OPEN]` items): whether `MeshTraceEvent` grows a
  `serviceVersion` field (cross-language wire change, filed in the benzene repo), cap-vs-TTL
  eviction policy.

### W2.5 Version-aware topic join at the getter layer (M)

- **.NET reference**: `src/Benzene.Core.MessageHandlers/MessageGetter.cs` (joins the optional
  `IMessageVersionGetter` via the shared
  `src/Benzene.Abstractions.MessageHandlers/Mappers/MessageTopicGetterExtensions.cs`
  `GetVersionedTopic`, so EVERY consumer of the getter is version-aware, not just the router);
  `Benzene.JsonSchema` validating the request's **declared version's** schema. Citations:
  R10 #98 (key item), R7-10 #69/#70, R15 #226 (recursive versioned-caster overflow).
- **TS current state (verified)**: `src/Benzene.Core.MessageHandlers/MessageGetter.ts` composes
  topic/body/headers getters only — no version join; `IMessageVersionGetter` is consumed ONLY by
  the `Benzene.Core.Versioning` casters. The router's lookup does select by
  `topic.version` (`MessageHandlerDefinitionLookUp.ts:24-29` via `VersionSelector`), so version
  routing works only when a transport's own topic getter sets `topic.version` — diagnostics and
  schema validation never see it. `src/Benzene.Ajv/` has zero version hits: validation is not
  version-aware (the #69 analog).
- **What to change**: port the #98 shape — `MessageGetter` optionally takes
  `IMessageVersionGetter<TContext>` and joins it into `getTopic` (a `getVersionedTopic` free
  function mirroring the C# extension); Ajv middleware selects the declared version's schema.
  Check `src/Benzene.Core.Versioning`'s recursive casters against the R15 #226 StackOverflow
  shape (a self-referential versioned DTO) — **[needs confirmation]** whether TS shares it.
- **Acceptance**: ported #98/#69 tests (a message with a version header validates against that
  version's schema, routes to that version's handler through the getter, and diagnostics see the
  versioned topic). **Keep** the standing .NET `[DECISION]`: unknown requested version silently
  falls back to max version (`VersionSelector`) — documented behavior, do not "fix".

---

## Wave 3 — remaining behavioral + auth

### W3.1 OAuth2 allowlist entry validation (S)

- **.NET reference**: R14-15 #244 (`MeshOidcOptions.Validate()` rejects null/whitespace entries
  and `"none"` **by name**, validates against known algorithms).
- **TS current state (verified)**: `OAuth2BearerOptions.ts:80-85` rejects only an EMPTY allowlist;
  a list containing `"none"` or whitespace entries passes construction (jose would refuse `none`
  at verify time, but fail-fast-at-startup is the ported rule).
- **What to change**: validate each entry — non-empty, not `"none"` (case-insensitive), member of
  the known signing algorithms.
- **Acceptance**: ported #244 tests (each bad entry shape throws at construction with a reason).

### W3.2 gRPC trailer truthfulness — verify streaming, watch unary (S)

- **.NET reference**: R17 #280 (shipped — streaming trailer written AFTER drain; mid-stream throw
  classified through the mapper/rich-error path), R17 #281 (health bridge downgrade parity),
  R14-15 #261 (duplicate-method case-fold). R18 #300 (unary/client-streaming stale trailer on
  response-conversion throw) is **planned-only** — see Blocked upstream.
- **TS current state (verified, by construction)**: `src/Benzene.Grpc/Extensions.ts:160-209` —
  the streaming bridges resolve to the trailer only after items are written and `end()` with it;
  a failure REJECTS and is emitted as a `GrpcBenzeneError` (no success trailer ever written
  early); `GrpcStreamAdapter.ts` explicitly does not `end()` (the caller ends once the trailer is
  known). The unary/client-streaming callbacks receive `{response, trailer}` atomically. The
  stale-`ok`-trailer bug shape appears absent.
- **What to do**: port the R17 #280 regression tests anyway (mid-stream handler throw over a real
  in-process grpc-js server → mapped code + truthful `benzene-status` + rich details, never `ok`)
  to pin the by-construction safety; check duplicate-method registration case-folds like routing
  (**[needs confirmation]** — `GrpcRouteFinder.ts`); check the health bridge's
  non-critical-Failed→Degraded parity if a grpc health bridge exists (**[needs confirmation]**).

### W3.3 Kinesis: decide the checkpoint model, then the watermark (M–L)

- **.NET reference**: `src/Benzene.Aws.Lambda.Kinesis/KinesisStreamCheckpointer.cs` — R17 #273:
  contiguous-prefix watermark (report the first UNconfirmed index, never past the max confirmed;
  a failed record is never silently skipped under `PartitionBy`; safe over-retry accepted).
  Rejected alternative (do not build): a per-partition checkpoint model — impossible under
  `ReportBatchItemFailures` (AWS reads one resume point).
- **TS current state**: `src/Benzene.Aws.Lambda.Kinesis` is a per-record fan-out **adaptation**
  (its own ADAPTATION note; `docs/capability-matrix.md:109`) — no checkpoint engine at all, so
  there is nothing to apply the watermark to yet.
- **What to change**: first a decision item — port the .NET streaming/checkpoint engine
  (sequential, stop-at-first-failure, `batchItemFailures` with the watermark semantics), or keep
  the adaptation and document that a returned failure result cannot be retried per-record. If
  porting: the watermark rule comes with it from day one. This also closes the Kinesis row of
  W1.1's "no knob" table.
- **Acceptance** (if ported): .NET R17 #273 tests (interleaved failures → first unconfirmed index
  reported; no skip); ESM `ReportBatchItemFailures` requirement documented in the package README.

### W3.4 Worker shutdown settlement (M)

- **.NET reference**: R10 #115–#117 — SQS/EventHub/ServiceBus self-hosted workers settle handled
  messages on a **cancellation-detached** context, so a stop signal doesn't abandon work the
  handler already completed (the Go port documents the identical rule).
- **TS current state**: `SqsConsumer.ts` deletes handled batches inside the poll loop and exits
  on `aborted` (lines 124-160); whether a stop signal arriving mid-batch still lets the delete of
  already-handled messages run is **[needs confirmation]**. Same question for
  `src/Benzene.Azure.ServiceBus/BenzeneServiceBusWorker.ts` (complete/abandon) and
  `src/Benzene.Azure.EventHub/BenzeneEventHubWorker.ts` (checkpoint hook).
- **What to change**: ensure the settle step (delete/complete/abandon/checkpoint) is not gated on
  the stop signal — run it to completion for records whose handler already finished; port the
  .NET shutdown-race tests.
- **Acceptance**: per-worker vitest — abort fired between handler completion and settlement still
  settles; abort before handling doesn't start new work.

### W3.5 Worker fault supervision (S–M)

- **.NET reference**: R17 #291 (`CompositeBenzeneWorker.StartAsync` races sibling faults; on
  fault, stop still-running workers and rethrow), R7-10 #88 (a hosted worker fault must surface,
  not idle).
- **TS current state (verified)**: `src/Benzene.SelfHost/CompositeBenzeneWorker.ts:18-24` is
  `Promise.all` over `startAsync` — the first rejection propagates but the surviving siblings are
  left running, and a fault after `startAsync` resolves is unobserved.
- **What to change**: on any worker's start fault, stop the still-running workers, then rethrow
  the original fault; decide + document how a long-lived worker's post-start fault surfaces
  (the `IBenzeneWorker` contract: does `startAsync` represent the run or the start?
  **[needs confirmation]** — read `Benzene.Abstractions.Middleware/Hosting/IBenzeneWorker.ts`
  first and follow it).
- **Acceptance**: ported #291 test (one worker of three faults → all stopped, fault rethrown,
  no orphan).

### W3.6 Saga result parity (M)

- **.NET reference**: `src/Benzene.Saga/SagaResult.cs` — additive `Failures` (ALL concurrent
  same-stage failures surfaced) and `StateStoreFailure`; rollback still runs on a state-store
  failure; retry policy re-runs only a **clean** rollback. Citations: R14-15 #208/#209/#253–#257.
- **TS current state (verified)**: `src/Benzene.Saga/SagaResult.ts` has `compensationFailures`
  only — no `failures`, no `stateStoreFailure`.
- **What to change**: port the two additive fields + the rollback-on-store-failure and
  clean-rollback-only-retry semantics; align names with the Go/.NET outcome vocabulary.
- **Acceptance**: ported .NET saga tests (two concurrent step failures in one stage both appear;
  a throwing state store doesn't prevent rollback and is reported; retry refuses a partial
  rollback).

### W3.7 XML serializer guards (S)

- **.NET reference**: R14-15 #260 (depth-counting reader guard, `XmlOptions.MaxDepth` 32),
  R15 #238 (null round-trip contract), R7-10 WP-L (UTF-8-BOM bodies accepted).
- **TS current state (verified)**: zero `depth` hits in `src/Benzene.Xml` — no depth guard.
  BOM/null-round-trip status **[needs confirmation]**.
- **What to change**: port the three fixes to the TS XML adapter (whatever subset applies to its
  parser dependency — if the underlying library already bounds depth, document that instead of
  double-guarding).
- **Acceptance**: ported tests — a deeply-nested bomb rejects at the cap; `null` round-trips per
  the .NET contract; a BOM-prefixed body parses.

### W3.8 S3 object-key codec (S)

- **.NET reference**: R11 #158–#165 (S3 notification keys URL-decoded on read; space arrives as
  `+`), R12-13 #191 (`S3ObjectKeyCodec` — encode/decode as ONE codec, test helpers use the
  inverse).
- **TS current state (verified)**: zero `decodeURIComponent` hits in `src/Benzene.Aws.Lambda.S3`
  — a key with spaces/unicode dispatches on the encoded form.
- **What to change**: port the codec (decode on read: `+` → space, then percent-decode) and use
  its encode half in test helpers.
- **Acceptance**: ported tests incl. the space→`+` case and a round-trip property test.

### W3.9 API Gateway v1 header/query normalization (S)

- **.NET reference**: R7-10 #89/#90 — the REST-API (v1) adapter lower-cases header keys and takes
  first-wins on multi-value query strings, matching v2/HTTP semantics.
- **TS current state (verified)**: `ApiGatewayMessageHeadersGetter.ts:20-28` copies v1 header
  keys verbatim (case preserved); the v2 context normalizes (`ApiGatewayV2Context.ts:61`).
- **What to change**: lower-case v1 header keys before mapping; align multi-value query handling
  with v2's first-wins. Check `ApiGatewayHttpRequestAdapter.ts` for the query half.
- **Acceptance**: ported #89/#90 tests (mixed-case `Content-Type` resolves; duplicate query key
  takes the first value; v1 and v2 agree).

### W3.10 Inbound correlation-id bounding (S)

- **.NET reference**: R7-10 #64 — the caller-supplied correlation id is sanitized/bounded before
  reuse (untrusted-input rule: it flows into logs and outbound headers).
- **TS current state**: `src/Benzene.Clients/CorrelationId/CorrelationIdBenzeneMessageClient.ts`
  has no length/character bounding (grep). Where the INBOUND id is accepted is
  **[needs confirmation]** — find the getter first.
- **What to change**: port the .NET bound (length cap + character set) at the point the inbound
  header is read.
- **Acceptance**: ported #64 tests (oversized/hostile id replaced or truncated per the .NET rule).

### W3.11 Client health-check info-leak rule (S)

- **.NET reference**: R18 #298's ruling — a client-facing health check reports the exception
  **type/category**, never `ex.message` (matches the Go port's long-documented "coarse error
  category, never the raw message" stance — the rule is settled cross-port even though the .NET
  fix is planned-only).
- **TS current state (verified)**: `src/Benzene.Clients.HealthChecks/ClientHealthCheck.ts:106`
  returns `ex.message` into the health payload.
- **What to change**: report the error's constructor name/category; keep the raw message for the
  server-side log hook only. Sweep the other `HealthChecks.*` checks for the same pattern
  (**[needs confirmation]** — `TcpHealthCheck`/`HttpHealthCheck`/`DynamoDb`/`TypeOrm`).
- **Acceptance**: test asserting the health `Data` bag contains no exception message text.

### W3.12 TS-own remainders from `work/remaining-items.md` (M)

Carried into this plan so one document drives the backlog (delete them from
`remaining-items.md` when done):

1. **Standalone-client typed wiring** — the standalone `IBenzeneMessageClient` path returns
   untyped results; no in-process standalone client exists in `src/Benzene.Clients.InProcess/`.
   The envelope + `asBenzeneResult` mechanism to reuse is in `@benzenejs/clients`.
2. **Error-payload bodies on failure** — `asBenzeneResult<TResponse>` returns a payload-less
   failure (`src/Benzene.Clients/Common/ClientResultExtensions.ts`, "the problem document is not
   surfaced in this cut"). Now that RFC 9457 problem documents are the wire contract, deserialize
   the problem document into the failure result the way .NET's `AsBenzeneResult` does.
   Option B (runtime `responseType` token) stays deferred per the archived design note §5.

### W3.13 Retry jitter + max-delay cap (S)

- **.NET reference**: the .NET `RetryMiddleware` has both; this port's matrix states plainly
  "no jitter/max-delay cap — not implemented" (`docs/capability-matrix.md:60`). Pre-existing gap,
  not a this-window diff — included because the goal is parity.
- **What to change**: `maxDelayMs` cap + full-jitter option on
  `src/Benzene.Resilience/RetryMiddleware.ts` (cap/jitter on the sleep only; growth curve
  uncapped — the AWS full-jitter shape the Go port documents), injectable RNG for tests.
- **Acceptance**: tests pin the sleep sequence with a seeded RNG; matrix row updated to drop the
  "not implemented" caveat.

---

## Wave 4 — API-ergonomics batch (HOLD until .NET's ergonomics round ships)

The ergonomics round (#318–#450) is **planned-only** in .NET (`work/ergonomics-fix-plan-2026-09.md`,
commit `46dd0db`, zero implementing commits). Porting API shapes from an unexecuted plan risks
porting a design that changes on contact with implementation. Hold ALL of it; when .NET Phase 1
lands, re-run this assessment against these watch items:

- **Start-up checks reach every entry point** (#318–#324): the *principle* (mis-wiring fails
  before the first message) is portable — audit which TS hosts run start-up checks when it lands.
- **CLI conventions** (#335–#337): `--help` exit codes, no-stdin behavior — check
  `src/Benzene.CodeGen.Client/Cli.ts` + `bin/` against whatever .NET decides.
- **Mesh wiring shorthands** (#338–#344): one constant for the dispatch path (the .NET UI default
  `/benzene/invoke` vs guard `/mesh/dispatch` disagreement, E9), public `UseMeshAnnounce` (E11),
  `UseMeshDispatchEndpoint` one-call wiring — TS has `MeshAnnouncer` in
  `src/Benzene.CloudService` already; align names once .NET settles them.
- **Shorthand ladder** (#357–#450): `design-principles.md` §4.1 (the commit both SPEC_VERSIONs
  point at) is already normative — when .NET ships its shorthands, port the ones whose explicit
  form exists here (`useExpress`/`BenzeneHost` already landed, TS commit `c56c5fd`).
- **Claim check** (`Benzene.ClaimCheck` + S3/Blob stores; spec `wire-contracts.md` §2.1, commit
  `2ce7332`): TS is honestly "unbuilt, no stated design reason" (`docs/capability-matrix.md:59`).
  New capability, Tier C optional, no conformance fixture — build here (offload/hydrate
  middleware pair + `benzene-claim-check` header per spec: resolve only through own store, no
  delete-on-consume) when prioritized; it is not gated on the ergonomics round, but it is not a
  parity *fix* either, so it holds at the back of the queue.

---

## Do not port

Rejected/deferred decisions from the .NET rulings, .NET-specific mechanics, and this port's own
recorded divergences. Resurrecting any of these needs a fresh maintainer decision, not a PR.

**Rejected in .NET rulings (do not re-litigate here):**
1. Any new settlement flags/options/enum values beyond the ported knob (settlement plan hard
   rule 5); swallowing an outbox/settle failure; flipping the Kafka/EventHub/fan-in ack-on-null
   carve-outs (declared policy, drift-guarded); a per-partition Kinesis checkpoint model
   (impossible under `ReportBatchItemFailures`).
2. Dispatch: audit-and-return-failure-result (ruled: audit-then-RETHROW); a pre-dispatch audit
   record (volume); a dedicated `DispatchTimeout` option (the fix is signal flow).
3. An `isolate: true` flag on bounded fan-out helpers (isolation is per-call-site policy —
   R12-13 #189).
4. Silent no-op on empty cache prefix (fail loudly — R12-13 #198 ruling, ported in W1.5).
5. Doc-only "startup-only registration" for the handlers list — runtime mutation is the
   supported contract (R14-15 #227); keep `MessageHandlersList` mutation-safe accordingly.
6. `ValidateOnBuild`-style global validation flip (ergonomics #320 — explicitly forbidden;
   opt-in status is a recorded measured decision).
7. API-freeze holds — do not "fix" the TS analogs ahead of the cross-port freeze decision:
   router value-type constraint, `CosmosChangeType.Unknown`, `SnsMessageBodyGetter` null-guard,
   missing-topic status asymmetry across transports (`ValidationError` vs `NotFound` — wire-
   visible; do NOT unilaterally normalize), unknown-version→max-version fallback ([DECISION]).
8. Verified-FALSE .NET findings (no bug exists): "gRPC client discards caller
   deadline/cancellation"; "outbound SQS/SNS return `Ok` not `Accepted`".
9. Mesh **UI** behaviors — routed upstream to `benzene-ui`; never hand-edit the vendored
   `mesh-ui.html` (R14-15 #205–#207 precedent; this repo has the drift-check to enforce it).
10. R18 WP-E's rejected alternative: a new mesh manifest `Error` field (spec change — reuse
    `Error`/`ErrorClass`).

**.NET-specific (no TS analog):** Autofac adapters, Roslyn source-generator diagnostics
(BENZ0001/0002/0010), `OwnedRateLimiter`/`IAsyncDisposable` sync-bridge mechanics (R16 #266,
R17 #289, R18 #297), NullLogger DI fallback shape (R12-13 #192 — though its rule, "the failure
path must not throw on absent logging", holds), STJ NaN/Infinity, Lambda test-host serializer
mismatch (#325), NuGet packaging (#413–#420), Mesh.Host deploy artifact wiring, AwsMesh
Terraform items (R18 #315–#317).

**This port's own recorded divergences (stand until re-decided):** no Outbox package
(`docs/capability-matrix.md:58` — "an honest divergence", DIY cookbook is the answer); Kafka +
Event Hub self-hosted workers at-most-once by default (`:112-118` — matches .NET's carve-outs);
mesh schema derivation via injected provider instead of reflection
(`MeshSchemaProvider.ts` header); third-party integrations adapted not reimplemented
(avsc, Cockatiel, jose, zod/joi/yup/ajv).

---

## Blocked upstream — re-check triggers

Track these; port only when the trigger fires. For each: what to watch in
`/home/user/benzene-dotnet`.

| Item | TS exposure (verified) | Trigger |
|---|---|---|
| R18 #300 gRPC unary/client-streaming stale `ok` trailer on response-conversion throw | TS looks safe by construction (`Extensions.ts:150-192` — response+trailer resolve atomically, failure rejects) | WP-C lands (commits after `f3f1be5` touching `Benzene.Grpc`); then port the .NET regression tests to pin TS |
| R18 #301 two `{param}`s in one route segment | **TS shares the bug shape**: `src/Benzene.Http/Routing/UrlMatcher.ts:39-41` uses `parameterKeys[0]` — the second param is silently dropped | WP-D lands; port the fail-fast-at-registration ruling + tests. If .NET stalls past one more round, promote to Wave 3 anyway (the fix is small and the current behavior is a silent misroute) |
| R18 #295 schema-comparer `additionalProperties` | **NOT APPLICABLE today** — TS ships only `TextualSchemaCompatibilityChecker` (byte-identical only, `docs/capability-matrix.md:63`); no structural comparer to fix | Only if TS grows a structural comparer |
| R18 #304 numeric-aware version ordering in cross-version compatibility comparison | Related to W2.4's comparators — W2.4 covers the collector half now | WP-E lands for the aggregator/compositor half |
| R18 #306–#309 collector store bounds / checked duration arithmetic / fan-out token | TS collector unbounded growth **[needs confirmation]** (`MeshCollectorStore.ts`) | WP-F lands; audit `_services`/`_topics`/instances maps + `MeshTimeRangeResolver` overflow then |
| R18 #310 RabbitMQ channel-shutdown detection + bounded reopen | `src/Benzene.RabbitMq/RabbitMqWorker.ts` reconnection posture **[needs confirmation]** (amqplib's model differs from the .NET client's auto-recovery) | WP-H lands; re-check whether amqplib even has the stale-delivery-tag failure mode before porting |
| R18 #311/#307 remaining cancellation stragglers (Pub/Sub egress, Tempo) | W1.3's sweep covers TS's own enumeration — do not wait | Cross-check the transport list against .NET's when WP-F/G land |
| R18 #312 Azure batch-creation failures mapped to `FailedBatchEntry` | TS batch client shape **[needs confirmation]** (`src/Benzene.Clients.Azure.*`) | WP-G lands |
| R18 #313 CloudWatch usage source `NextToken` page merge per query Id | `src/Benzene.Mesh.Usage.CloudWatch/CloudWatchUsageSource.ts` **[needs confirmation]** | WP-I lands |
| R18 #302/#303/#305 mesh aggregator spec-parse signal / slug collision / Lambda self-report caveat | TS aggregator **[needs confirmation]** | WP-E lands |
| Ergonomics round #318–#450 | see Wave 4 | `work/ergonomics-fix-plan-2026-09.md` status header flips from planned; Phase 1 merge commits appear |
| Spec-repo `[OPEN]` wire questions — descriptor `transports: null` vs `[]`; `produces`/outbound-registry naming (fixture is arbiter); `MeshTraceEvent.serviceVersion`; settlement axes entering `docs/specification/**`; implicit health exposure | fixtures here are the tripwire | a fixture-touching commit in `/home/user/Benzene/docs/specification/conformance/` → re-vendor + re-run |

---

## Process tail — documentation lifecycle (after each wave, and at the end)

Per the main repo's `docs/documentation-lifecycle.md` (the "one rule" definition of done):

1. **After each wave lands**: run **`capability-scribe`** in THIS repo (agent definition vendored
   at `.claude/agents/`, copy-don't-fork) — it reads the diff and source, never this plan, and
   updates `docs/capability-matrix.md`. Its first run must also clear the **three named TS scribe
   debts** recorded in the main repo's `docs/capabilities.md` (line 177): (a) conformance-fixture
   vendoring attestation (reality: fully in sync — the matrix just doesn't say so), (b) which
   asset `Benzene.Mesh.Ui` serves (reality: the canonical `mesh-ui.html`, byte-identical,
   drift-checked), (c) whether `Benzene.Auth.OAuth2` includes JWKS/OIDC discovery (reality: yes,
   both).
2. **Then**: a **`port-aligner`** refresh of `/home/user/Benzene/docs/capabilities.md` (main repo
   only; reads only the four port matrices, never port source).
3. **Any observable cross-language contract change** discovered during the work belongs in
   `/home/user/Benzene/docs/specification/**` first — raise it there, never encode it TS-only
   (the settlement-axes promotion in W1.1 is the known pending case).
4. **When this plan is fully actioned**: **`docs-archivist`** stamps it with the evidence and
   moves it to `work/archive/`; any live remainder goes to `work/remaining-items.md` (whose two
   current entries W3.12 absorbs — delete them there when done).
