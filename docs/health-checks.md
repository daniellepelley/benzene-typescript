# Health Checks

Health checks let a service report whether it — and the things it depends on (a database, a
downstream HTTP API, a queue) — are in a state where it can do its job.

## Overview

A service built on Benzene almost always depends on other resources: a database, a storage
location, or another service. Health checks let you verify that a service has access to everything
it needs and is in the right state to operate.

In Benzene, a health check isn't a special HTTP-only concept bolted onto the framework — it's just
another topic in the middleware pipeline. `useHealthCheck(app, topic, config)` adds a middleware
that intercepts messages for that topic (and the default `'healthcheck'` topic), runs your
registered `IHealthCheck`s, and returns an aggregated `IHealthCheckResponse`. Because it's ordinary
middleware, it works identically across every transport Benzene supports — AWS Lambda (API Gateway,
SNS, SQS, Kafka), Azure Functions, Express, or a self-hosted worker — with no special endpoint
plumbing beyond the same free-function `use*(app, …)` calls you use everywhere else.

This page is the reference for writing checks, registering the built-in ones, and exposing a health
endpoint. For the Kubernetes liveness/readiness split built on top of this, see
[Kubernetes Health Checks](kubernetes-health-checks.md).

## Installation

| Package | What it adds |
| --- | --- |
| `@benzene/health-checks-core` | The abstractions: `IHealthCheck`, `IHealthCheckResult`, `IHealthCheckResponse<T>`, `HealthCheckStatus`, `HealthCheckDependency`, `IHealthCheckBuilder`, `IHealthCheckFactory`. Pulled in transitively by the packages below. |
| `@benzene/health-checks` | The processor, `HealthCheckBuilder`, the `useHealthCheck`/`useLivenessCheck`/`useReadinessCheck` middleware, and the built-in `SimpleHealthCheck`/`InlineHealthCheck`/`FailedHealthCheck` checks. |
| `@benzene/health-checks-disk` | `DiskHealthCheck` / `addDiskSpaceCheck` — free space on a drive. |
| `@benzene/health-checks-http` | `HttpPingHealthCheck` / `addHttpPing` — pings a downstream HTTP URL. |
| `@benzene/health-checks-tcp` | `TcpHealthCheck` / `addTcpPing` — opens a TCP connection to a host/port. |
| `@benzene/health-checks-dynamodb` | `DynamoDbHealthCheck` / `addDynamoDbHealthCheck` — a read-only `DescribeTable` reachability probe for a DynamoDB table. |
| `@benzene/health-checks-azure-service-bus` | `ServiceBusHealthCheck` / `addServiceBusQueueHealthCheck` / `addServiceBusSubscriptionHealthCheck` — a read-only `peekMessages` reachability probe for a queue or a topic subscription. |
| `@benzene/health-checks-schema` | `SchemaHealthCheck` / `addSchemaHealthCheck` — publishes a hash of the service's own message contract under the `schema` check, so a consumer can detect contract drift. |
| `@benzene/clients-health-checks` | `ClientHealthCheck` / `addContractCheck` — the consumer-side companion: probes a downstream provider via its generated client and reports whether its contract has drifted. |

```bash
npm install @benzene/health-checks
# plus whichever built-in checks you need:
npm install @benzene/health-checks-disk @benzene/health-checks-http @benzene/health-checks-tcp
# ...and the reachability/contract checks where you depend on those resources:
npm install @benzene/health-checks-dynamodb @benzene/health-checks-azure-service-bus @benzene/health-checks-schema
```

Add `@benzene/health-checks` to any project that wires up a pipeline; add the disk/http/tcp/dynamodb/
service-bus packages only where you need those specific checks.

Beyond the standalone check packages, several **consumer workers and client packages auto-wire their
own dependency reachability check** for the resource they talk to — see
[Dependency reachability checks](#dependency-reachability-checks) below.

> **Porting note.** The .NET library also ships `Benzene.HealthChecks.EntityFramework`, a
> `MemoryHealthCheck`, a `ShutdownReadinessHealthCheck`, a per-check `Timeout`/`IsNonCritical`
> override, and a grpc.health.v1 bridge. Those have no TypeScript port yet — this doc only covers
> what exists in `src/`. (The AWS/Azure/Kafka/RabbitMq reachability probes **are** ported now — see
> [Dependency reachability checks](#dependency-reachability-checks).) See
> [Not yet ported](#not-yet-ported).

## Basic usage

Health check middleware goes inside the same pipeline callback as everything else (the `pipeline` /
`app` handed to your host — the Express `benzene((pipeline) => …)` callback, a Lambda entry point,
etc.):

```ts
import { useHealthCheck } from '@benzene/health-checks';
import {
  addInlineHealthCheck,
  addBoolHealthCheck,
  addBoolHealthCheckWithType,
} from '@benzene/health-checks';
import { HealthCheckResult } from '@benzene/health-checks-core';
import { SimpleHealthCheck } from '@benzene/health-checks';

useHealthCheck(app, 'healthcheck', (checks) => {
  checks.addHealthCheck(SimpleHealthCheck);                        // a DI-resolved check class
  addBoolHealthCheckWithType(checks, 'inline', () => true);        // named boolean check
  addBoolHealthCheckWithType(checks, 'inline', async () => true);  // async boolean check
  addBoolHealthCheck(checks, () => true);                          // unnamed (type "inline")
  addInlineHealthCheck(checks, () => HealthCheckResult.createInstance(true, 'adhoc'));
});
```

Send it a health check request the same way you'd send any other message. For a `BenzeneMessage`-based
transport (SNS/SQS/Kafka) that's a message with the matching topic:

```json
{ "topic": "healthcheck" }
```

The response is a JSON payload describing whether the service is healthy overall and the result of
each individual check (see [Response format](#response-format) below). Over an HTTP transport the
same aggregate maps to a `200`/`503` status code — see [Exposing a health endpoint](#exposing-a-health-endpoint-in-the-pipeline).

## Core concepts

### `IHealthCheck`

```ts
export interface IHealthCheck {
  readonly type: string;                        // its key in the aggregated response
  executeAsync(): Promise<IHealthCheckResult>;  // report failures via the result, don't throw
}
```

`type` is the name used to identify the check in the response — it's the value used as (or to
derive) the check's key in the response record. Everything else about the interface is intentionally
minimal: no context object is passed in, so a check gets whatever it needs (a client, a URL, ...) via
constructor injection instead. Don't throw for an *expected* failure (a refused connection, a
non-200 response) — report it as a failed `IHealthCheckResult`. An error that *does* escape is caught
for you (see [the internal safety net](#the-internal-safety-net)).

`IHealthCheck` declares a merged `ServiceToken` constant, so DI-resolved checks are registered and
discovered by that token (`resolver.getServices(IHealthCheck)`) — TypeScript erases the type C#
resolves `IEnumerable<IHealthCheck>` by.

### `IHealthCheckResult` / `HealthCheckResult`

```ts
export interface IHealthCheckResult {
  readonly status: string;                          // a HealthCheckStatus value
  readonly type: string;
  readonly data: Record<string, unknown>;           // free-form diagnostic metadata
  readonly dependencies: HealthCheckDependency[];   // the external dependencies this check verifies
}
```

`data` is a free-form metadata bag — put whatever's useful for diagnosing a failure in there (e.g.
`Url`, `StatusCode`, `FreeBytes`). `HealthCheckResult` implements the interface and exposes static
factory helpers instead of a public-facing constructor for the common cases:

```ts
HealthCheckResult.createInstance(success: boolean);                                     // type "Unknown", empty data
HealthCheckResult.createInstance(success: boolean, type: string);
HealthCheckResult.createInstance(success: boolean, type: string, data, dependencies?);
HealthCheckResult.createInstanceAsync(success: Promise<boolean>, type: string);         // async overload
HealthCheckResult.createWarning(type: string, data?, dependencies?);
```

`createInstance` maps `success` to `HealthCheckStatus.ok` or `HealthCheckStatus.failed`;
`createWarning` always produces `HealthCheckStatus.warning`.

> **Port note.** C#'s `CreateInstance(bool)`/`(bool, type)`/`(bool, type, data)` overloads collapse
> into one `createInstance` with optional parameters. The `Task<bool>` overload can't share that
> signature once awaited, so it splits by name to `createInstanceAsync`, per the porting convention.

### `HealthCheckStatus`

Three string constants, used as the `status` value (a frozen object; camelCased member names, exact
wire values):

| Constant | Value | Effect on `isHealthy` |
| --- | --- | --- |
| `HealthCheckStatus.ok` | `'ok'` | Healthy |
| `HealthCheckStatus.warning` | `'warning'` | Still counted as healthy |
| `HealthCheckStatus.failed` | `'failed'` | Flips the aggregate response to unhealthy |

Only `failed` affects the aggregate result — a check that reports `warning` shows up in the response
so you can see it, but doesn't take the whole service down.

### `HealthCheckDependency`

```ts
new HealthCheckDependency(kind: string, name: string);
```

Describes one external dependency a check verifies connectivity to — `kind` is an open category
(`'Http'`, `'Tcp'`, `'Disk'`, `'Queue'`, ...) and `name` is the resource identifier (a URL, a
`host:port`, a path). Never a connection string or other secret. The built-in checks each attach one;
your own checks can attach as many as make sense.

### `IHealthCheckResponse<T>` / `HealthCheckResponse`

```ts
export interface IHealthCheckResponse<THealthCheckResult extends IHealthCheckResult> {
  readonly isHealthy: boolean;
  readonly healthChecks: Record<string, THealthCheckResult>;
}
```

This is the payload the health middleware returns — `isHealthy` is `true` only if every registered
check's `status` is not `failed`; `healthChecks` maps a (de-duplicated, see
[naming](#result-naming-and-deduplication)) name to each check's result.

## Registering health checks: `IHealthCheckBuilder`

```ts
export interface IHealthCheckBuilder {
  addHealthCheck(healthCheck: InjectableConstructor<IHealthCheck>): IHealthCheckBuilder;
  addHealthCheckFn(func: (resolver: IServiceResolver) => IHealthCheck): IHealthCheckBuilder;
  getHealthChecks(resolver: IServiceResolver): IHealthCheck[];
}
```

There are two fundamentally different ways a check gets registered, and it matters which one you pick:

- **`addHealthCheck(SomeCheck)`** registers `SomeCheck` as a **scoped** `IHealthCheck` in the DI
  container, discovered at request time through `IHealthCheckFinder`
  (`resolver.getServices(IHealthCheck)`). Because of that, it also picks up *any* `IHealthCheck`
  registered directly in the container by other code — not just the ones added through this specific
  `useHealthCheck()` call.
- **`addHealthCheckFn(func)`** is scoped to *this* builder only — the function is stored in a private
  list and invoked (wrapped as an `InlineHealthCheck`) when `getHealthChecks(resolver)` runs, without
  touching DI at all.

> **Port note.** C# names both the generic `AddHealthCheck<T>()` and `AddHealthCheck(Func<…>)`
> the same; a class constructor and a plain function are indistinguishable once TypeScript erases
> their types, so they split by name — `addHealthCheck` takes the check *class*, `addHealthCheckFn`
> takes the resolver *function*.

`@benzene/health-checks-core` adds these free-function builder helpers on top of the two members
(C# extension methods become free functions taking the builder first):

```ts
import {
  addHealthCheckInstance,   // register an already-constructed instance
  addHealthChecks,          // register several instances at once
  addHealthCheckFactory,    // register via an IHealthCheckFactory (e.g. HttpPingHealthCheckFactory)
} from '@benzene/health-checks-core';

addHealthCheckInstance(checks, new SimpleHealthCheck());
addHealthChecks(checks, new SimpleHealthCheck(), new SimpleHealthCheck());
addHealthCheckFactory(checks, new HttpPingHealthCheckFactory('https://svc/health'));
```

`@benzene/health-checks` adds inline helpers for one-off checks that don't need their own class,
covering sync/async and `boolean`/`IHealthCheckResult` return types, with or without an explicit type:

```ts
import {
  addInlineHealthCheckWithType,   // named, returns an IHealthCheckResult (sync or async)
  addInlineHealthCheck,           // unnamed (empty type), returns an IHealthCheckResult
  addBoolHealthCheckWithType,     // named, returns a boolean (sync or async)
  addBoolHealthCheck,             // unnamed (type "inline"), returns a boolean
} from '@benzene/health-checks';
```

> **Port note.** Each C# inline helper appears twice (a sync delegate and a `Task`-returning one),
> indistinguishable once erased. The port keeps one function per named variant whose delegate may
> return the value *or* a `Promise` of it; `Promise.resolve` normalizes both. The named/unnamed and
> result/bool distinctions — genuinely different call shapes — stay as separate functions. All of
> them build an `InlineHealthCheck` under the hood; you rarely construct one yourself.

## Built-in health checks

### `SimpleHealthCheck` (`@benzene/health-checks`)

Always succeeds. `type` is `'Simple'`. Useful as a smoke test that the health pipeline itself is
reachable, or as a placeholder while you build out real checks.

### `InlineHealthCheck` (`@benzene/health-checks`)

Wraps a `() => Promise<IHealthCheckResult>` with an optional leading `type` (defaulting to `''`,
which the response namer then names `'HealthCheck-1'` — the bare `'HealthCheck'` key is pre-reserved,
so an empty type never lands on it; see [naming](#result-naming-and-deduplication)). This is what
every inline `add*HealthCheck` helper above constructs for you.

### `FailedHealthCheck` (`@benzene/health-checks`)

Wraps a pre-existing error. `type` is `'Failed'`; `executeAsync()` always returns a `failed` result
with the error's **class name** (not its message — the same secret-safety convention the rest of the
health checks follow) in `data.Exception`. `buildHealthCheck(func)` uses this to turn a check
*construction* failure (a factory that throws) into a reportable result instead of an unhandled error:

```ts
import { buildHealthCheck } from '@benzene/health-checks';

addHealthCheckInstance(checks, buildHealthCheck(() => new MyCheck(mustNotThrow())));
```

### `DiskHealthCheck` / `addDiskSpaceCheck` (`@benzene/health-checks-disk`)

A host self-check on free disk space for the drive containing a given path. Reports `failed` below a
hard minimum, an optional `warning` below a soft threshold (degraded but not fatal — does not flip
aggregate `isHealthy`), otherwise healthy. `type` is `'Disk'`; `data` includes `Drive`, `FreeBytes`,
`TotalBytes`, and `MinimumFreeBytes`.

```ts
import { addDiskSpaceCheck } from '@benzene/health-checks-disk';

useHealthCheck(app, 'healthcheck', (checks) =>
  addDiskSpaceCheck(checks, '/', 500 * 1024 * 1024, 1024 * 1024 * 1024),
  //                        path  minimumFreeBytes    warningFreeBytes (optional)
);
```

> **Port note.** .NET's `DriveInfo` maps to `node:fs`'s `statfs`, which exposes no drive/mount name,
> so the checked `path` stands in as the drive identifier. Byte counts are `number` (64-bit doubles,
> exact for real disk sizes) rather than C#'s `long`.

### `HttpPingHealthCheck` / `addHttpPing` (`@benzene/health-checks-http`)

`GET`s a URL and reports healthy only on a `200 OK` response (any other status code, including other
2xx codes, is `failed`). `type` is `'HttpPing'`; `data` includes `Url` and `StatusCode`, and it
attaches one `HealthCheckDependency('Http', url)`.

```ts
import { addHttpPing } from '@benzene/health-checks-http';

useHealthCheck(app, 'healthcheck', (checks) =>
  addHttpPing(checks, 'https://downstream-service/health'));
```

> **Port note.** .NET injects an `HttpClient` and calls `GetAsync`; there's no container-registered
> `HttpClient` token in the port, so the check/factory instead take an optional `fetchFn` (a
> `(url) => Promise<Response>`) defaulting to the Node global `fetch`. Pass a stub in tests to avoid a
> real network call — the ported test does exactly this. `addHttpPing(checks, url, fetchFn?)`.

### `TcpHealthCheck` / `addTcpPing` (`@benzene/health-checks-tcp`)

Verifies a dependency is reachable at the TCP level by opening a connection to a host and port — the
lowest-common-denominator check for anything without a first-class client (a database port, an SMTP
server, a custom service). Healthy if the connection is accepted; `failed` on any socket error.
`type` is `'Tcp'`; `data` includes `Host` and `Port` (and `Error`, the error's class name, on
failure), with one `HealthCheckDependency('Tcp', 'host:port')`.

```ts
import { addTcpPing } from '@benzene/health-checks-tcp';

useHealthCheck(app, 'healthcheck', (checks) =>
  addTcpPing(checks, 'db.internal', 5432));
```

> **Port note.** .NET's `TcpClient.ConnectAsync` maps to `node:net`'s `connect`. C#'s ambient
> `ICancellationTokenAccessor` (resolved from DI by the factory) has no ported DI seam yet, so
> `CancellationToken` becomes an optional `AbortSignal` on the `TcpHealthCheck` constructor;
> `TcpHealthCheckFactory` / `addTcpPing` don't wire one up today.

## Aggregation, timeouts, and the internal safety net

`HealthCheckProcessor.performHealthChecksAsync(topic, checks)` runs a set of checks and aggregates
their outcomes. It's what every `useHealthCheck`/`useLivenessCheck`/`useReadinessCheck` middleware
calls; you can also call it directly (e.g. in tests — see [Testing](testing-benzene.md)).

```ts
import { HealthCheckProcessor } from '@benzene/health-checks';

const result = await HealthCheckProcessor.performHealthChecksAsync('healthcheck', checks);
```

What it does:

- **Runs every check concurrently** (`Promise.all`), so total latency is the slowest check, not the
  sum.
- **Wraps every check** — before running — in a `TimeOutHealthCheck` around an
  `ExceptionHandlingHealthCheck` (see below). Your `IHealthCheck` implementations need not implement
  their own timeout or error handling.
- **Aggregates**: `isHealthy` is `true` unless at least one check reports `HealthCheckStatus.failed`;
  a `warning` does not flip it.
- **Names** each result via `HealthCheckNamer` so keys stay unique (see
  [naming](#result-naming-and-deduplication)).
- **Returns an `IBenzeneResult`** whose payload is a `HealthCheckResponse`, with status `ok`
  (HTTP 200) when healthy or `serviceUnavailable` (HTTP 503 — but flagged *successful*, so the body
  still renders the report) when not. See [HTTP status codes](#http-status-codes).

### The internal safety net

Two decorators run around *every* check automatically — you never construct them yourself, but it's
worth knowing they're there:

- **`ExceptionHandlingHealthCheck`** — catches any error thrown out of `executeAsync()` and turns it
  into a `failed` result with the error's **class name** (not its message) in `data.Exception`,
  instead of letting it propagate and abort the whole run.
- **`TimeOutHealthCheck`** — a fixed **10-second** timeout (`TimeOutHealthCheck.timeoutMs`). If the
  wrapped check hasn't completed by then, it returns a `failed` result with `data.Error = 'Timed Out'`
  instead of waiting indefinitely. This only stops *waiting* — the inner promise isn't cancelled and
  runs to completion in the background.

> **Port note.** In the .NET library the timeout is configurable (a processor-wide default plus a
> per-check `IHealthCheck.Timeout` override), and a check can opt out of criticality with
> `IsNonCritical`. Neither is ported yet — the TypeScript `TimeOutHealthCheck` timeout is a fixed
> 10 seconds and the `IHealthCheck` interface carries no `timeout`/`isNonCritical`. Make a slow
> check's own internal timeout (an `AbortSignal`, a client timeout) comfortably shorter than 10s so
> you get a meaningful `data.Error` from the check itself rather than the generic `'Timed Out'`.

## Exposing a health endpoint in the pipeline

### Message-topic based (every transport)

`useHealthCheck` is generic over `TContext`, so it works on any pipeline (`BenzeneMessage`, SNS, SQS,
Kafka, Azure Functions, Express, self-hosted workers):

```ts
export type HealthCheckConfig =
  | IHealthCheck[]
  | ((builder: IHealthCheckBuilder) => void)
  | IHealthCheckBuilder;

export function useHealthCheck<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  topic: string,
  config: HealthCheckConfig,
): IMiddlewarePipelineBuilder<TContext>;
```

The `config` parameter accepts an array of instances, a builder-configuring callback, or an
already-built `IHealthCheckBuilder` — C#'s three `UseHealthCheck` overloads collapse into one
parameter dispatched at runtime.

The middleware checks the incoming message's topic against **both** the `topic` you passed and the
constant default topic `'healthcheck'` (`Constants.defaultHealthCheckTopic`) — so even if you wire it
up under a custom topic like `'orders-service:healthcheck'`, it's still reachable via the plain
`'healthcheck'` topic too. If neither matches, the middleware calls `next()` and gets out of the way.

```ts
import { useHealthCheck } from '@benzene/health-checks';
import { addHttpPing } from '@benzene/health-checks-http';

useHealthCheck(app, 'orders-service:healthcheck', (checks) => {
  checks.addHealthCheck(OrdersDbHealthCheck);
  addHttpPing(checks, 'https://payments/health');
});
```

### HTTP path based (Express and other HTTP hosts)

On an HTTP host the topic is resolved from the request's method + path *before* the health middleware
runs, via the route table (`IRouteFinder`, from registered `@httpEndpoint` decorators and
`IHttpEndpointDefinition`s). To make an incoming `GET /healthz` reach the health middleware, register
a route that maps that path to the health topic, then wire the middleware by topic as usual:

```ts
import express from 'express';
import { benzene } from '@benzene/express';
import { DefaultBenzeneServiceContainer, IBenzeneServiceContainer } from '@benzene/dependencies';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzene/http';
import { useHealthCheck, Constants } from '@benzene/health-checks';
import { addHttpPing } from '@benzene/health-checks-http';

const container = new DefaultBenzeneServiceContainer();
// Map GET /healthz onto the health topic so the Express host resolves it to a topic Benzene owns.
container.addSingletonFactory(
  IHttpEndpointDefinition,
  () => new HttpEndpointDefinition('GET', '/healthz', Constants.defaultHealthCheckTopic),
);

const app = express();
app.use(
  benzene((pipeline) => {
    useHealthCheck(pipeline, Constants.defaultHealthCheckTopic, (checks) =>
      addHttpPing(checks, 'https://downstream-service/health'));
  }, { container }),
);
app.listen(8080);
```

Now `GET /healthz` returns `200` when healthy and `503` when not. The route registration is what lets
the Express host hand the request to Benzene at all — an unmatched path falls straight through to the
rest of your Express app.

> **Porting note.** `Benzene.Aws.Lambda.ApiGateway` exposes dedicated method+path `UseHealthCheck`
> overloads in .NET; the TypeScript port has no path overload — use the topic-based `useHealthCheck`
> together with an `IHttpEndpointDefinition` route (as above) on any HTTP transport.

### Kubernetes-style liveness/readiness

`useHealthCheck` runs one undifferentiated set of checks. For Kubernetes (or any platform with a
liveness-vs-readiness distinction) `@benzene/health-checks` also provides `useLivenessCheck` and
`useReadinessCheck` — see [Kubernetes Health Checks](kubernetes-health-checks.md) for the full guide,
including which checks belong in which and example probe YAML.

## Response format

The response payload is a `HealthCheckResponse` (`IHealthCheckResponse<HealthCheckResult>`),
serialized through whatever serializer your app uses. The default camelCases the declared properties
(`isHealthy`, `healthChecks`, `status`, `type`, `data`, `dependencies`) but **not** the contents of
the `data` record, since a naming policy only rewrites declared properties, not arbitrary record
keys. That's why the built-in checks' `data` keys stay `PascalCase` (`Url`, `StatusCode`, `Host`, ...)
exactly as they're set:

```json
{
  "isHealthy": false,
  "healthChecks": {
    "Simple": { "status": "ok", "type": "Simple", "data": {}, "dependencies": [] },
    "HttpPing": {
      "status": "ok",
      "type": "HttpPing",
      "data": { "Url": "https://downstream-service/health", "StatusCode": 200 },
      "dependencies": [{ "kind": "Http", "name": "https://downstream-service/health" }]
    },
    "Tcp": {
      "status": "failed",
      "type": "Tcp",
      "data": { "Host": "db.internal", "Port": 5432, "Error": "Error" },
      "dependencies": [{ "kind": "Tcp", "name": "db.internal:5432" }]
    }
  }
}
```

A single `failed` check flips the whole response's `isHealthy` to `false` even if every other check
succeeded; an `ok`/`warning` check leaves it `true`.

### HTTP status codes

Over an HTTP transport the response's HTTP status code reflects `isHealthy`, not just its body:
`200` when healthy, `503 Service Unavailable` when not (mapped by the default status-code mapper,
same as everywhere else in Benzene). This matters because most health-check consumers — a Kubernetes
HTTP probe, a load-balancer target-health check — only look at the status code, not the body, so a
check whose body said `"isHealthy": false` but whose status code was still `200` would be silently
treated as healthy. `HealthCheckProcessor` handles this for every `useHealthCheck` /
`useLivenessCheck` / `useReadinessCheck` variant, over every transport, with no extra configuration.

`data.Error` / `data.Exception` entries (populated when a check fails with an error, or times out)
report the error's *class name* (e.g. `'Error'`, `'AggregateError'`), not its message — error
messages can carry infrastructure detail, and this response can flow out to whatever can reach the
health topic with no built-in authorization.

### Result naming and deduplication

Each entry's key in `healthChecks` comes from `HealthCheckNamer`, run against the `type` on the
*executed* result:

- An empty/undefined `type` is named `'HealthCheck-1'` — the bare `'HealthCheck'` key is pre-seeded
  as already used, so the first empty-type check is suffixed rather than taking it (a second becomes
  `'HealthCheck-2'`, and so on).
- If a name has already been used, `HealthCheckNamer` appends `-2`, `-3`, ... to keep keys unique
  rather than one check's result silently overwriting another's — e.g. two `SimpleHealthCheck`s show
  up as `'Simple'` and `'Simple-2'`.

## Example: a custom health check class

The cleanest way to add a non-trivial check is as its own class, which is also the shape
`addHealthCheck(Class)` / DI resolution expects:

```ts
import {
  HealthCheckResult,
  HealthCheckDependency,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzene/health-checks-core';

export class OrdersDbHealthCheck implements IHealthCheck {
  constructor(private readonly db: OrdersDb) {}

  get type(): string {
    return 'OrdersDb';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const canConnect = await this.tryConnect();
    return HealthCheckResult.createInstance(
      canConnect,
      this.type,
      { CanConnect: canConnect },
      [new HealthCheckDependency('Database', 'orders')],
    );
  }

  private async tryConnect(): Promise<boolean> {
    try {
      await this.db.ping();
      return true;
    } catch {
      return false; // an expected failure is a failed result, not a thrown error
    }
  }
}
```

Register it with `checks.addHealthCheck(OrdersDbHealthCheck)` (DI-resolved) — make sure `OrdersDb` is
registered in the same container the pipeline is built from.

## Dependency reachability checks

The checks above are ones *you* register. Benzene also ships **reachability probes for the external
resources a service talks to** — the queue it consumes, the table it reads, the downstream it calls —
and most of them are **auto-wired**: adding the transport or client already registers its check, so you
don't hand-write an `IHealthCheck` per dependency.

### Where they run — the dependency category, never a probe

Auto-wired dependency checks are registered under a distinct DI category, `IDependencyHealthCheck`, and
are harvested **only by the deep `'healthcheck'` topic** — never by the Kubernetes liveness or readiness
probes. A dependency check is *shared-fate*: every replica runs the same probe against the same
downstream, so a transient blip fails them all at once. Gating liveness on that would restart-storm the
fleet; gating readiness on it would pull every pod from the load balancer together. So these checks feed
monitoring, humans, and the mesh inventory, while the probes stay about *this* instance. (You can still
add a specific dependency to readiness by hand if you've reasoned it's safe to gate traffic on — the
auto-wiring just never does it for you.) See
[Kubernetes Health Checks](kubernetes-health-checks.md) for the full probe split.

Each check carries a stable `dedupKey` (the dependency's `kind:name`), so two registrations of the same
resource — two `useSns(sameArn)` calls, say, or the same Service Bus queue reached from more than one
place — collapse to a single check.

Failures are classified with a shared policy: an **authorization** failure (an HTTP 401/403 or a known
auth error code) becomes a *persistent* failure — retrying won't fix a missing IAM permission or SAS
claim — while anything else (an unreachable broker, a timeout) is *transient*. The probe never leaks the
underlying error message; it reports the dependency, a status code, and an error code only.

### What's wired, and how

| Package | Check | Wiring |
| --- | --- | --- |
| `@benzene/azure-service-bus` | `ServiceBusHealthCheck` (peek) for the consumed queue/subscription | `useServiceBus(app, config, …, healthCheck = true)` |
| `@benzene/rabbitmq` | `RabbitMqHealthCheck` (passive `checkQueue`) | `useRabbitMq(app, config, …, healthCheck = true)` |
| `@benzene/kafka-core` | `KafkaHealthCheck` (cluster metadata, subscribed topics present) | `useKafka(app, config, consumerFactory, action, adminClientFactory, healthCheck = true)` |
| `@benzene/clients-aws-sns` · `-sqs` · `-eventbridge` · `-step-functions` | Send-side reachability for the target resource | Auto-registered by the client's `use*` wiring (`healthCheck = true` default) |
| `@benzene/clients-aws-lambda` | `AwsLambdaHealthCheck` (`GetFunctionConfiguration`) | Shipped, registered explicitly (no auto-wiring) |
| `@benzene/health-checks-dynamodb` | `DynamoDbHealthCheck` (`DescribeTable`) | `addDynamoDbHealthCheck(builder, tableName, dynamoDb)` (explicit) |
| `@benzene/health-checks-azure-service-bus` | `ServiceBusHealthCheck` (peek) | `addServiceBusQueueHealthCheck` / `addServiceBusSubscriptionHealthCheck` (explicit) |

(The SQS and Event Hub **consumer** workers carry no reachability check — neither does the .NET original;
the send-side `@benzene/clients-aws-sqs` covers SQS reachability.)

The Service Bus and Rabbit MQ consumer workers default `healthCheck` to `true`; pass `false` to opt out
(e.g. in a test that only exercises routing). Kafka is the one exception — its probe needs
cluster-metadata access the consumer config doesn't carry, so it stays off until you supply an
`IKafkaAdminClientFactory`:

```ts
// Auto-wired: adding the consumer also registers its reachability check on the deep 'healthcheck' topic.
useServiceBus(app, { queueName: 'orders' }, clientFactory, (pipeline) => { /* … */ });

// Opt out (routing only, no dependency check):
useServiceBus(app, { queueName: 'orders' }, clientFactory, (pipeline) => { /* … */ }, false);

// Kafka: supply an admin factory to enable the metadata probe.
useKafka(app, { topics: ['orders'] }, consumerFactory, (pipeline) => { /* … */ }, adminClientFactory);
```

> **Porting note.** In .NET a consumer's `Use*` builds the reachability check's client from the same
> config it consumes with. The TypeScript configs are leaner — they don't carry broker/connection
> settings — so the check reuses the factory you already pass for consuming (Service Bus, Rabbit MQ), and
> Kafka needs the extra `IKafkaAdminClientFactory` seam because the consumer factory yields a `Consumer`
> with no route to an `Admin`. These are noted in the README porting-conventions table.

To register a dependency check yourself (a resource with no auto-wiring, or a bespoke probe), use
`addDependencyHealthCheck(services, () => new MyCheck(), 'MyResource:name')` from
`@benzene/health-checks-core` — the same primitive the auto-wiring uses.

## Troubleshooting

- **A check never seems to finish, it just reports `failed` after ~10 seconds.** That's
  `TimeOutHealthCheck` — every check gets a fixed 10-second budget. Make a slow-by-design check's own
  internal timeout comfortably shorter so you get a meaningful `data.Error` from the check itself
  rather than the generic `'Timed Out'`. (Unlike .NET, this budget isn't configurable in the port
  today.)
- **Two checks with the same `type` and I can't tell them apart.** See
  [naming](#result-naming-and-deduplication) — look for the `-2`/`-3` suffix, or give each check a
  distinct `type`.
- **My health topic isn't reachable from outside.** Remember `useHealthCheck` also always responds to
  the plain `'healthcheck'` topic in addition to whatever topic you passed, and — on HTTP hosts —
  that the request path must resolve to that topic via a registered route (see
  [HTTP path based](#http-path-based-express-and-other-http-hosts)).
- **`addHealthCheck(Class)` doesn't pick up my check.** Confirm the class is resolvable (scoped) in
  the same container the pipeline is built from — `addHealthCheck(Class)` only adds a DI registration;
  it doesn't construct the instance itself. For a check you already have an instance of, use
  `addHealthCheckInstance(checks, instance)` instead.

## Not yet ported

Several .NET health-check features have no TypeScript port today, and are deliberately omitted here
rather than fabricated:

- **`Benzene.HealthChecks.EntityFramework`** (`DatabaseConnectionHealthCheck<T>` /
  `DatabaseHealthCheck<T>`) — write your own `IHealthCheck` against your data layer (see
  [the example above](#example-a-custom-health-check-class)).
- **`MemoryHealthCheck`** and **`ShutdownReadinessHealthCheck`** — the host-self-check and
  graceful-drain checks.
- **Per-check configurable `timeout` / `isNonCritical`** — the port's timeout is a fixed 10s and the
  interface carries neither flag.
- **The grpc.health.v1 bridge** (`Benzene.Grpc.AspNet`).

The transport/resource **reachability probes** (DynamoDB, Azure Service Bus, Kafka, Rabbit MQ, and the
send-side AWS clients) and their read-only IAM/claim requirements **are** ported — see
[Dependency reachability checks](#dependency-reachability-checks).

The consumer-side **contract-drift** check also has a partial port (`@benzene/clients-health-checks`'
`ClientHealthCheck` / `addContractCheck`), paired with the provider-side `@benzene/health-checks-schema`
(`SchemaHealthCheck` / `addSchemaHealthCheck`) that publishes the hash it compares against — but no
`useContractsCheck` middleware exists yet — see
[Kubernetes Health Checks](kubernetes-health-checks.md#client--contract-drift-checks-belong-in-neither-probe).

## See Also

- [Kubernetes Health Checks](kubernetes-health-checks.md) — liveness/readiness probes built on this
- [Common Middleware](common-middleware.md) — `useHealthCheck` alongside the other pipeline middleware
- [Middleware](middleware.md) — how middleware ordering and inline middleware work in general
- [Message Results](message-result.md) — the result type the processor returns
- [Testing Benzene](testing-benzene.md) — driving `HealthCheckProcessor` and checks from tests
