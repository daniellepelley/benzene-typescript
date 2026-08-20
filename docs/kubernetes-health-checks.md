# Kubernetes Health Checks

`@benzenejs/health-checks` provides purpose-built liveness/readiness convenience functions on top of the
general-purpose [health checks](health-checks.md) support, matching [Kubernetes' own liveness/readiness/
startup probe model](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).
This page covers the semantics, how to wire them up per transport, and example probe configuration.
Read [Health Checks](health-checks.md) first if you haven't — this page assumes you know
`IHealthCheck` / `IHealthCheckBuilder` and doesn't repeat that material.

## Liveness vs. readiness

Kubernetes' guidance is specific about what belongs in each, and Benzene doesn't second-guess it:

- **Liveness** answers "is this process itself still working?" A liveness probe failure causes
  Kubernetes to **restart the pod**. Keep liveness checks cheap and local — verify the process can
  still do work at all, not that every external dependency is reachable. Checking a database or
  downstream service in a liveness probe is a well-known anti-pattern: a flaky dependency would cause
  Kubernetes to restart pods that are actually fine, potentially triggering a restart storm across
  your whole fleet in response to one struggling downstream service.
- **Readiness** answers "is this instance ready to receive traffic right now?" A readiness probe
  failure only **removes the pod from the Service's endpoint list** — no restart, traffic just stops
  routing to it until it passes again. Readiness is for **instance-local** conditions: warmup not
  finished, this pod's connection pool is rebuilding, this pod is shedding load.

> **Caution — don't reflexively put every external-dependency check in readiness.** A check against a
> *shared* downstream (a queue, a database, an API every replica talks to) is **shared-fate**: all
> replicas run the same check against the same dependency, so a transient blip fails **all** their
> readiness probes at once and Kubernetes pulls **every** pod from the Service. The Service then has
> **zero endpoints** — callers get connection-refused / DNS failures instead of a structured 503,
> turning a *degradation* into a *total outage*. De-routing only helps when some replicas are healthy
> to shed to; for a shared dependency there are none. Gate readiness on a dependency **only** when
> you've reasoned it's a hard, synchronous dependency you truly cannot serve *any* traffic without.
> When in doubt, use the deep `healthcheck` layer instead (below).

For a dependency you *have* reasoned is safe to gate on, register it explicitly under readiness — e.g.
`@benzenejs/health-checks-http`'s [`addHttpPing`](health-checks.md#httppinghealthcheck--addhttpping-benzenejshealth-checks-http),
`@benzenejs/health-checks-tcp`'s
[`addTcpPing`](health-checks.md#tcphealthcheck--addtcpping-benzenejshealth-checks-tcp), or your own
check via `useReadinessCheck(...)`.

### The deep `healthcheck` layer, not a probe

Point a Kubernetes probe at liveness/readiness, and your monitoring/mesh at the general `healthcheck`
topic — not the other way around. The `healthcheck` layer (`useHealthCheck`) is meant to be scraped
by monitoring, the mesh, or humans; it triggers no automated Kubernetes action, so a rich set of
external-dependency checks there gives you *visibility* without the shared-fate cascading-failure risk
above.

### Client / contract-drift checks belong in *neither* probe

A generated client's contract-drift check (`@benzenejs/clients-health-checks`' `ClientHealthCheck` /
`addContractCheck`) is **not** an ordinary external-dependency check, and it does not belong in a
liveness *or* a readiness probe. It calls a *downstream provider's* health endpoint and compares
contract hashes, so it fails the two tests above harder than a database check does:

- **It is transitive.** The thing it checks — another service's health endpoint — may itself
  aggregate *that* service's dependencies. Put it in a liveness probe and one slow leaf service
  **restarts** healthy consumer pods across the fleet; put it in a readiness probe and the outage
  **propagates upstream** — the failing provider's consumers look unready to *their* consumers,
  de-routing an entire dependency chain over a single leaf failure.
- **Contract drift is a versioning signal, not a serve-traffic signal.** A drifted-but-working
  provider reports `warning`, which deliberately does not flip `isHealthy` (see
  [`HealthCheckStatus`](health-checks.md#healthcheckstatus)). A pod one contract revision behind can
  still serve traffic perfectly — restarting it or pulling it from rotation over that annotation is
  never the right response.

So keep these checks off the liveness/readiness probes. Scrape them from monitoring / the mesh
instead.

> **Porting note.** The .NET library ships a dedicated probe-less `contracts` topic and a
> `UseContractsCheck` middleware for exactly this. The TypeScript port has the `ClientHealthCheck` and
> `addContractCheck`/`addContractCheckInstance` builder helpers (`@benzenejs/clients-health-checks`) but
> **no `useContractsCheck` middleware yet** — register the contract checks on a topic of your own via
> the general `useHealthCheck` and scrape it directly, until the dedicated middleware is ported.

## Topic-based wiring (every transport): `useLivenessCheck` / `useReadinessCheck`

Both are free functions taking the pipeline builder first, generic over `TContext`, so they work on
any transport:

```ts
export function useLivenessCheck<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  config: HealthCheckConfig,
): IMiddlewarePipelineBuilder<TContext>;

export function useReadinessCheck<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  config: HealthCheckConfig,
): IMiddlewarePipelineBuilder<TContext>;
```

`config` is the same [`HealthCheckConfig`](health-checks.md#message-topic-based-every-transport) the
general `useHealthCheck` takes — an array of instances, a builder-configuring callback, or a
prebuilt `IHealthCheckBuilder`.

```ts
import { useLivenessCheck, useReadinessCheck } from '@benzenejs/health-checks';
import { addHttpPing } from '@benzenejs/health-checks-http';
import { addTcpPing } from '@benzenejs/health-checks-tcp';

useLivenessCheck(app, (checks) =>
  checks.addHealthCheck(ProcessResponsiveCheck)); // your own check: cheap, no external I/O

useReadinessCheck(app, (checks) => {
  addTcpPing(checks, 'db.internal', 5432);        // a dependency you've reasoned is safe to gate on
  addHttpPing(checks, 'https://downstream/health');
});
```

Each responds only to its own topic — `Constants.defaultLivenessTopic` (`'liveness'`) and
`Constants.defaultReadinessTopic` (`'readiness'`). Unlike `useHealthCheck`, **neither also matches**
`Constants.defaultHealthCheckTopic` (`'healthcheck'`). This is deliberate: if both did, whichever was
registered first in the pipeline would silently swallow every request for the shared `'healthcheck'`
topic, and the other would never run for it.

## HTTP-path wiring (Express and other HTTP hosts)

On an HTTP host the topic is resolved from the request's method + path before the health middleware
runs, via the route table. There is no dedicated path overload in the port (the .NET
`Benzene.Aws.Lambda.ApiGateway` package's `UseLivenessCheck`/`UseReadinessCheck` HTTP-path overloads
default to `/livez` and `/readyz`) — instead, register an `IHttpEndpointDefinition` mapping each
conventional probe path to the liveness/readiness topic, then wire the middleware by topic:

```ts
import express from 'express';
import { benzene } from '@benzenejs/express';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzenejs/http';
import { useLivenessCheck, useReadinessCheck, Constants } from '@benzenejs/health-checks';
import { addHttpPing } from '@benzenejs/health-checks-http';

const container = new DefaultBenzeneServiceContainer();
// Map the conventional Kubernetes probe paths onto the liveness/readiness topics.
container.addSingletonFactory(
  IHttpEndpointDefinition,
  () => new HttpEndpointDefinition('GET', '/livez', Constants.defaultLivenessTopic),
);
container.addSingletonFactory(
  IHttpEndpointDefinition,
  () => new HttpEndpointDefinition('GET', '/readyz', Constants.defaultReadinessTopic),
);

const app = express();
app.use(
  benzene((pipeline) => {
    useLivenessCheck(pipeline, (checks) => checks.addHealthCheck(ProcessResponsiveCheck));
    useReadinessCheck(pipeline, (checks) => addHttpPing(checks, 'https://downstream/health'));
  }, { container }),
);
app.listen(8080);
```

Registering the route is what lets the Express host hand `GET /livez` / `GET /readyz` to Benzene at
all — an unmatched path falls straight through to the rest of your Express app. No message-handler
registration is needed for these routes: the liveness/readiness middleware intercepts the request
directly by topic, before any handler resolution would run.

## Example Kubernetes manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-benzene-service
spec:
  template:
    spec:
      containers:
        - name: my-benzene-service
          image: my-registry/my-benzene-service:latest
          ports:
            - containerPort: 8080
          livenessProbe:
            httpGet:
              path: /livez
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
```

Both probes work correctly against Benzene's response because the HTTP status code — not just the
JSON body — reflects health: `200` when healthy, `503 Service Unavailable` when not (see
[HTTP status codes](health-checks.md#http-status-codes)). Kubernetes' `httpGet` probe type only
inspects the status code (2xx–3xx is a pass, anything else a failure), so this matters — a health
check that returned `200` unconditionally, with the real status only in the body, would never
actually fail a Kubernetes probe.

## What this does not cover

- **Startup probes.** Kubernetes' third probe type (for slow-starting containers) has no dedicated
  Benzene wiring — reuse `useReadinessCheck` (or a separate topic/path of your own) for it; there's
  nothing startup-probe-specific in Benzene today.
- **Graceful shutdown coordination.** The .NET `ShutdownReadinessHealthCheck` (flip readiness
  unhealthy on `SIGTERM` so Kubernetes stops routing while in-flight requests drain) is **not ported**
  yet. Until it is, pair a `preStop` sleep / `terminationGracePeriodSeconds` with your own readiness
  latch if you need drain coordination.
- **gRPC probes.** The .NET grpc.health.v1 bridge and its liveness/readiness split
  (`BenzeneGrpcOptions`) have no TypeScript port.

## See also

- [Health Checks](health-checks.md) — the general-purpose health check system this builds on
- [Common Middleware](common-middleware.md) — `useLivenessCheck`/`useReadinessCheck` alongside the
  other pipeline middleware
- [Middleware](middleware.md) — how middleware ordering works in general
