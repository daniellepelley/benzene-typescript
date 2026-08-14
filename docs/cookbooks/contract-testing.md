# Contract Testing (catching breaking changes before they reach consumers)

Benzene services talk to each other by topic + payload, and consumers often use a generated typed client.
This cookbook shows how a provider publishes its live contract hash, how a consumer detects when that
contract has drifted from what its client was built against, and how to gate a deploy on black-box wire
conformance.

## Problem statement

A service evolves its message contract (a handler's request/response shape, or the set of topics it
answers). Some changes are safe (adding an optional response field); some break consumers (removing a
response field, adding a required request field). You want to know **before** the change reaches a
consumer, not from a production incident.

The TypeScript port gives you two complementary mechanisms:

- **Runtime contract-drift detection** — the provider publishes a hash of its current contract; a consumer
  compares it against the hash its client was generated with and reports drift on a diagnostic topic.
- **A deploy-time black-box conformance probe** — `CloudServiceProbe` hits a running service's `/benzene/*`
  surfaces and reports a tri-state verdict against the Cloud Service Profile (R1–R8).

> **Port note.** The .NET original of this cookbook also ships a build-time compatibility gate
> (`SchemaCompatibility.EnsureBackwardCompatible`, from `Benzene.Schema.OpenApi.Compatibility`) that
> throws on breaking changes in a unit test. **That gate is not ported yet** — `@benzenejs/schema-openapi`
> ports the `EventServiceDocument` builder but not the `Compatibility` comparer. Until it lands, use the
> runtime drift check plus the black-box probe below, and — for a lightweight CI gate — snapshot the
> service's `/benzene/spec` document and diff it (see [A lightweight CI gate](#a-lightweight-ci-gate)).

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service — see [Getting Started](../getting-started.md).
- Familiarity with [Health Checks](../health-checks.md) — the drift check is an `IHealthCheck`.

## Mechanism 1 — runtime contract-drift check

The provider publishes a hash of its live contract as a `schema` health check; a consumer's client fetches
that health response and compares the hash to the one it was generated against. A mismatch means the
provider's contract has moved.

### Provider — publish the live contract hash

`addSchemaHealthCheck` (`@benzenejs/health-checks-schema`) registers a check that hashes every registered
handler's topic + request/response schema and publishes it under the `schema` health check. Register it on
the general `healthcheck` topic via `useHealthCheck`:

```bash
npm install @benzenejs/health-checks @benzenejs/health-checks-schema
```

```ts
// OrderServiceStartUp.ts (provider)
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { useHealthCheck } from '@benzenejs/health-checks';
import { addSchemaHealthCheck } from '@benzenejs/health-checks-schema';
import { BenzeneStartUp } from '@benzenejs/testing';
import { CreateOrderHandler } from './handlers.js';

export class OrderServiceStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) =>
      useApiGateway(aws, (api) => {
        useMessageHandlers(api, CreateOrderHandler);
        useHealthCheck(api, 'healthcheck', (health) => {
          addSchemaHealthCheck(health); // publishes the live contract hash under "schema"
        });
      }),
    );
  }
}
```

> The hash `@benzenejs/health-checks-schema` publishes is stable across every TypeScript component that hashes
> a contract (the mesh descriptor, the `/benzene/spec` endpoint, and this check), which is exactly what the
> drift loop needs. Its **value** differs from the .NET port's — the two serialize the spec document
> differently — so this loop is TypeScript-provider ↔ TypeScript-consumer; a cross-language drift check is
> not something the current hashes support.

### Consumer — compare the provider's hash with the client's

A generated client bakes in the hash it was generated against. The consumer side of the loop is
`ClientHealthCheckProcessor.process(providerResponse, clientHash)`, which reads the provider's `schema`
hash, compares it, and annotates the response with a `ClientHashMatch` verdict. Wrap that in an
`IHasHealthCheck` so the drift check can drive it:

```bash
npm install @benzenejs/clients-health-checks
```

```ts
// OrderServiceClient.ts (consumer)
import { IBenzeneResultOf, ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { HealthCheckResponse } from '@benzenejs/health-checks-core';
import { ClientHealthCheckProcessor, IHasHealthCheck } from '@benzenejs/clients-health-checks';

export const IOrderServiceClient: ServiceToken<IHasHealthCheck> =
  serviceToken<IHasHealthCheck>('IOrderServiceClient');

export class OrderServiceClient implements IHasHealthCheck {
  // The contract hash this client was generated against, baked in at codegen time.
  readonly hashCode = 'e3b0c44298fc1c14';

  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async healthCheckAsync(): Promise<IBenzeneResultOf<HealthCheckResponse>> {
    // Call the provider's healthcheck topic (over whatever transport the client is bound to).
    const result = await this.sender.sendAsync<unknown, HealthCheckResponse>('healthcheck', {});
    if (!result.isSuccessful || result.payload === undefined) {
      return result;
    }
    // Compare the provider's live hash with ours and annotate the drift verdict onto the response.
    const annotated = ClientHealthCheckProcessor.process(result.payload, this.hashCode);
    return BenzeneResult.ok(new HealthCheckResponse(annotated.isHealthy, annotated.healthChecks));
  }
}
```

### Register the drift check on its own topic

`ClientHealthCheck` (registered by `addContractCheck`) folds that annotated response into one verdict:
reachable + matching → `ok`, reachable + drifted → `warning`, unreachable → `failed`.

```ts
// ConsumerStartUp.ts
import { useHealthCheck } from '@benzenejs/health-checks';
import { addContractCheck } from '@benzenejs/clients-health-checks';
import { IOrderServiceClient, OrderServiceClient } from './OrderServiceClient.js';

// in configureServices:
services.addScoped(IOrderServiceClient, OrderServiceClient);

// in configure, inside your transport wiring:
useHealthCheck(api, 'contracts', (health) => {
  addContractCheck(health, 'OrderService', IOrderServiceClient);
});
```

> **Wire the contract check to monitoring, not to a probe.** It calls a *downstream* service and reports
> contract drift, so it belongs on a dedicated diagnostic topic (`contracts` above) that your mesh /
> alerting scrapes — **never** in a Kubernetes liveness or readiness probe. Coupling it to a probe lets a
> struggling dependency (or a compatible-but-changed contract) restart or de-route pods that are themselves
> healthy, and drift is a versioning signal, not a serve-traffic one. See
> [Kubernetes Health Checks → contract-drift checks belong in neither probe](../kubernetes-health-checks.md#client--contract-drift-checks-belong-in-neither-probe).

> **Port note.** .NET ships a dedicated probe-less `contracts` topic and a `UseContractsCheck` middleware
> for exactly this. The port has `ClientHealthCheck` and `addContractCheck`/`addContractCheckInstance`
> (`@benzenejs/clients-health-checks`) but **no `useContractsCheck` middleware yet** — register the contract
> check on a topic of your own via the general `useHealthCheck` and scrape it directly, as above.

## Mechanism 2 — a deploy-time black-box conformance probe

`CloudServiceProbe` (`@benzenejs/cloud-service-probe`) is an external, black-box auditor: it POSTs a small set
of fixed synthetic envelopes at a live service's `/benzene/*` surfaces and returns a **tri-state**
assessment of the Cloud Service Profile's R1–R8, built only from what it observed — it never trusts what the
service claims about itself. Run it against a freshly-deployed service (a smoke/gate step in CI) to confirm
it is reachable and wire-conformant before promoting it:

```bash
npm install --save-dev @benzenejs/cloud-service-probe
```

```ts
// conformance.smoke.test.ts
import { describe, expect, it } from 'vitest';
import { CloudServiceProbe } from '@benzenejs/cloud-service-probe';

describe('deployed OrderService conformance', () => {
  it('is wire-conformant to the Cloud Service Profile', async () => {
    const report = await CloudServiceProbe.runAsync('https://orders.example.com');

    // Ids the probe positively observed as UNMET must be empty.
    expect(report.notSatisfied).toEqual([]);

    // Ids it structurally cannot observe from outside (e.g. R8, half of R6) — treat as "unknown",
    // never as a pass. `runAsync` never throws for an unreachable service; it reports a verdict.
    console.log('inconclusive:', report.inconclusive);
  });
});
```

`runAsync(baseUrl, options?, fetchFn?, signal?)` returns a `CloudServiceProbeReport` with:

- `notSatisfied` — requirement ids observed as unmet (assert this is empty);
- `inconclusive` — ids unobservable from a single external HTTP vantage point (never treat as a pass);
- `isFullyConformant` — true only when *every* requirement was observed as satisfied. Because R8 (and half
  of R6) are structurally unobservable from outside, this is essentially never `true` for a real service —
  that is the honest ceiling of a black-box probe, so gate on `notSatisfied` being empty, not on
  `isFullyConformant`.

Point it at non-default paths with `CloudServiceProbeOptions` (`invokePath`, `specPath`, `healthPath`,
`sendTraceParentProbe`).

## A lightweight CI gate

Until the compatibility comparer is ported, the simplest pre-merge stop is to snapshot the service's
contract document and diff it. The `/benzene/spec` endpoint (served by `useSpec` from
`@benzenejs/schema-openapi`) is the same contract the schema health check hashes:

1. In CI, fetch `/benzene/spec` from the service (or render it from the handler definitions) and write it to
   `spec.baseline.json`, committed to the repo.
2. On each PR, regenerate it and fail the build if it differs from the committed baseline — a diff is a
   contract change that a human must acknowledge (regenerate the baseline deliberately when the change is
   intended).

This is coarser than .NET's direction-aware `EnsureBackwardCompatible` (which distinguishes additive from
breaking changes) — it flags *any* change — but it needs nothing beyond the ported `/benzene/spec` surface
and stops an unnoticed contract change from merging.

To browse that contract interactively while developing, mount the Spec UI with `useSpecUi`
(`@benzenejs/spec-ui`), which renders the `useSpec` document in-browser.

## Troubleshooting

### The consumer's drift check always reports `ok`, even after a provider change

`ClientHealthCheckProcessor` can only compare when the provider actually publishes a `schema` health check —
confirm the provider registered `addSchemaHealthCheck` and that the consumer is reading the same
`healthcheck` response. If the provider has no `schema` check, there is no hash to compare and the check
stays `ok` (it never invents drift).

### The probe reports lots of `inconclusive` ids

That is expected and honest — a single external HTTP probe genuinely cannot observe R8 (and half of R6).
Gate on `report.notSatisfied` being empty, and treat `inconclusive` as "verify by other means", never as a
pass.

### `CloudServiceProbe.runAsync` returns instead of throwing for a dead service

By design — unreachability is reported as a verdict (R1/R3 `NotSatisfied`), not an exception, so one call
classifies a service whether it's up or down. An externally-supplied `AbortSignal` still propagates.

## Further reading

- [Schema Registry (applied)](schema-registry.md) — registering payload schemas centrally so a producer
  can't ship a breaking wire change silently.
- [Schema Registry (reference)](../schema-registry.md) — the `@benzenejs/schema-registry-core` surface.
- [Health Checks](../health-checks.md) — the `IHealthCheck` model and the `schema` check.
- [Kubernetes Health Checks](../kubernetes-health-checks.md) — why the contract check belongs on neither
  probe.
- [Clients](../clients.md) — the generated typed clients that carry the contract hash.
- [Payload Testing](../payload-testing.md) — the `CloudServiceProbe` surface in context.
