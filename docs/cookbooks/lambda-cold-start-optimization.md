# Lambda Cold Start Optimization

Reduce the cold-start latency of a Benzene AWS Lambda — with a mix of Benzene-specific structure and
standard Node/Lambda tuning.

## Problem Statement

The first invocation after a scale-up (a cold start) pays for the runtime initializing, your bundle
loading and evaluating, dependency-injection wiring, and Benzene building its pipeline. You want to shrink
that one-off cost so latency-sensitive endpoints stay responsive.

## Prerequisites

- An AWS Lambda Benzene service (see [AWS Lambda Setup](../getting-started-aws.md)).
- Familiarity with your bundler ([esbuild](https://esbuild.github.io/)) and deployment configuration
  (SAM, Serverless Framework, CDK, …).

## What happens on a cold start

`InlineAwsLambdaStartUp` builds the DI container and the Benzene middleware pipeline in `build()`. When
you call `build()` at **module scope** — as every example in these docs does — that work runs **once**, as
the Lambda execution environment loads your bundle, and is reused for every subsequent invocation on that
warm instance. So the cold-start work is: runtime init → bundle load + evaluation →
`configureServices` → `configure` (pipeline build). The steps below each target one of those.

```ts
// index.ts — the shape that makes cold-start cost a one-off
const entryPoint = new InlineAwsLambdaStartUp()   // ┐
  .configureServices((services) => addBenzene(services)) // │ all of this runs ONCE, at module load,
  .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, PlaceOrderHandler))) // │ on cold start
  .build();                                        // ┘

export const handler = toLambdaHandler(entryPoint); // each invocation reuses the built pipeline
```

## Step-by-Step Implementation

### 1. Build the pipeline once, at module load — never inside the handler

This is the single most important rule, and it's the one that's easy to get wrong. Construct
`InlineAwsLambdaStartUp`, call `.build()`, and wrap it with `toLambdaHandler` **at the top level of your
entry module** — not inside the exported function. The example above does this correctly.

The anti-pattern that reintroduces the full cold-start cost on **every** invocation:

```ts
// ✗ DON'T: rebuilds the container and pipeline on every single request
export const handler = async (event, context) => {
  const entryPoint = new InlineAwsLambdaStartUp()          // rebuilt every invoke!
    .configureServices((services) => addBenzene(services))
    .configure((app) => useApiGateway(app, (api) => useMessageHandlers(api, PlaceOrderHandler)))
    .build();
  return toLambdaHandler(entryPoint)(event, context, () => undefined);
};
```

Keep `build()` at module scope. `toLambdaHandler(entryPoint)` closes over the built entry point and
returns the correctly-bound function AWS invokes — and it's also the fix for the classic detached-`this`
bug: never `export const handler = entryPoint.functionHandlerAsync` (it compiles, but assigning the method
detaches `this` and the pipeline is lost). See [AWS Lambda Setup](../getting-started-aws.md#4-write-the-composition-root-and-the-entry-point).

### 2. Keep `configureServices` cheap — defer expensive initialization to first use

`configureServices` runs on cold start, so anything expensive done *eagerly* there (opening a database or
Redis connection, loading a large model, reading a remote secret) lands directly on cold-start latency.
Register services, but let them connect **lazily** on first use instead:

```ts
export interface IOrderStore {
  getAsync(id: string): Promise<Order>;
}
export const IOrderStore: ServiceToken<IOrderStore> = serviceToken<IOrderStore>('IOrderStore');

export class DynamoOrderStore implements IOrderStore {
  private clientPromise?: Promise<DynamoDBClient>;

  // Built once, on first use, then reused for the life of the warm instance — NOT in the constructor.
  private client(): Promise<DynamoDBClient> {
    this.clientPromise ??= Promise.resolve(new DynamoDBClient({}));
    return this.clientPromise;
  }

  async getAsync(id: string): Promise<Order> {
    const client = await this.client();
    // ...use client
    return { id } as Order;
  }
}
```

Benzene's own [Redis cache service](redis-caching.md) opens its connection lazily in the background for
exactly this reason. A lazy connection also means an idle warm instance holds fewer resources, and the
first real request — not the cold start — pays the connect cost (which you can hide behind provisioned
concurrency, step 5).

### 3. Keep the dependency graph and the bundle lean

Every import in your entry module is evaluated on cold start, and every dependency adds to bundle size.

- **Only pull in the [packages](../getting-started-aws.md#supported-event-sources) you use.** Benzene's
  packages are small and focused — install one transport package per event source (`@benzene/aws-lambda-api-gateway`,
  `@benzene/aws-lambda-sqs`, …), not the whole family.
- **Prefer AWS SDK v3's per-service clients** (`@aws-sdk/client-dynamodb`, not the monolithic v2 `aws-sdk`)
  so the bundler only includes the API you call.
- **Bundle and tree-shake with esbuild**, and minify — this is the Node analog of .NET's trimming. A
  smaller `index.mjs` loads and evaluates faster:

```bash
npx esbuild src/index.ts --bundle --minify --platform=node --format=esm --target=node22 \
  --outfile=dist/index.mjs \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
```

> **No handler-discovery scan to remove.** The .NET guide's biggest lever is replacing reflection-based
> `AddMessageHandlers(assembly)` with a compile-time source generator. The TypeScript port has **no
> reflection scan to begin with**: a handler self-registers when its module is imported (the `@message`
> decorator runs at load time), and you pass each handler class explicitly to `useMessageHandlers(...)`.
> There's nothing equivalent to `AddGeneratedMessageHandlers()` because there's no assembly scan on the
> cold-start path in the first place.

### 4. Prefer arm64 (Graviton) and enough memory

arm64 Lambdas generally start faster and cost less, and memory size scales CPU — and cold-start work is
CPU-bound, so raising memory often *reduces* wall-clock cold-start time. Set both in your deployment
config (SAM shown; the same knobs exist in Serverless Framework and CDK):

```yaml
Globals:
  Function:
    Runtime: nodejs22.x
    Architectures:
      - arm64
    MemorySize: 1024   # more memory also means more CPU during init
```

### 5. Consider provisioned concurrency for critical paths

For endpoints that can't tolerate any cold start, use AWS **provisioned concurrency** to keep warm
instances ready — their `build()` has already run, so requests skip cold-start init entirely. It has a
cost trade-off, so reserve it for latency-critical functions.

## Testing / measuring

Measure before and after — cold-start optimization is easy to guess wrong:

- Look at the `Init Duration` reported in the Lambda CloudWatch logs (that's the cold-start init, dominated
  by bundle evaluation + `configureServices` + `configure`).
- Compare across a few deploys, changing **one** variable at a time (arm64, memory, minification, lazy
  connection).
- Locally, `console.time`/`console.timeEnd` around the module-level `build()` gives a rough read on how
  much of init your pipeline construction accounts for.

## Troubleshooting

### Every invocation is slow, not just the first

You're almost certainly rebuilding the pipeline per request — `build()` (or `new InlineAwsLambdaStartUp()`)
is inside the handler function instead of at module scope. Move it out (step 1). A correctly-structured
function pays the build cost only on cold start.

### Raising memory didn't help

If init is dominated by I/O (e.g. eagerly connecting to a database in a constructor), extra CPU won't
help — defer that work to first use instead (step 2).

### Cold starts got worse after adding a dependency

A heavy transitive dependency inflates bundle load/evaluation time. Check your bundle size
(`esbuild --analyze`), drop unused packages, and make sure you're importing the specific AWS SDK v3 client
rather than a monolithic SDK.

## Variations

### Split transports across functions doesn't multiply cold starts

The port's default is one Lambda function per transport (Model A in
[AWS Lambda Setup](../getting-started-aws.md#7-add-a-second-transport)). Cold starts scale with
*concurrency*, not function count, so splitting an API-Gateway function from an SQS worker doesn't add
cold-start cost — each function still builds its own pipeline once per warm instance.

## Further Reading

- [AWS Lambda Setup](../getting-started-aws.md) — the entry-point builder and where `build()` runs.
- [Redis Caching](redis-caching.md) — an example of lazy connection init.
- [Deploy with the Serverless Framework](deploy-with-serverless-framework.md) — arch/memory knobs in
  `serverless.yml`.
- [Hosting](../hosting.md) — the one-handler-many-hosts model these functions are built on.
- [AWS: Lambda performance best practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html).
