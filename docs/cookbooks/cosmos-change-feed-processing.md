# Cosmos DB Change Feed Processing

Consume a Cosmos DB container's change feed with Benzene as an ordered stream of documents — either
behind an Azure Functions trigger or in a self-hosted worker with manual per-batch checkpoint control.

## Problem Statement

You have a Cosmos DB container and want to react to document changes — build materialized views,
invalidate caches, project events into another store — without hand-rolling change-feed plumbing. Doing
this well means understanding a few things up front:

- Why the Cosmos DB adapter looks different from every other Benzene Azure transport (no
  `useMessageHandlers()`, generic over your document type, a **stream** rather than per-document dispatch).
- How Benzene processes a batch internally (one pipeline run over an ordered stream, one DI scope).
- What Benzene controls about checkpointing and retries — and what the host owns.
- What redelivery looks like when your handler fails, and why idempotency is non-negotiable.

The port offers two hosting modes, and here they differ in **who owns the checkpoint**:

| Host | Package | Checkpoint control | Guide |
| --- | --- | --- | --- |
| Azure Functions trigger | `@benzenejs/azure-function-cosmos-db` | The trigger's lease (auto, on success) | [Azure Functions Setup](../azure-functions.md#other-triggers) |
| Self-hosted worker | `@benzenejs/azure-cosmos-db` | Benzene, with a manual per-batch checkpoint hook | [Unified Hosting Model](../hosting.md#cosmos-db-change-feed--usecosmosdbchangefeed) |

This cookbook works through both, citing the actual source in `src/Benzene.Azure.Function.CosmosDb/` and
`src/Benzene.Azure.CosmosDb/`.

## Why this transport is a stream, not message routing

Every other Benzene Azure transport (Event Hubs, Service Bus, Kafka) receives an opaque payload — bytes
plus headers — that Benzene deserializes and routes to a message handler by topic. The change feed is
fundamentally different: it delivers **documents of a concrete type you choose**, already deserialized. A
changed document has no envelope, no topic, no headers — it's just your data. So there's nothing for
`useMessageHandlers()` to route on, and the pipeline is generic over the document type instead:
`useCosmosDbChangeFeed<TDocument>(...)` builds a pipeline of `StreamContext<TDocument>` and you terminate
it with `useStream(...)` (from `@benzenejs/core-middleware`).

And it's **fan-in** (one stream), not fan-out (per-document dispatch): the feed delivers changes in order
within each partition-key range, and checkpoints a whole batch at a time — there's no per-document resume
token. Fanning out would throw ordering away and create false failure isolation (one failed document can't
be retried alone — the whole batch redelivers). So Benzene presents the batch intact: one
`StreamContext<TDocument>`, one pipeline run, one DI scope, documents pulled lazily in feed order. This is
the same streaming engine as AWS's Kinesis stream, and the stream operators compose with it.

## The document type (shared by both hosts)

The type changes are deserialized into — typically a projection of the container's documents with the
properties you care about (`src/OrderDocument.ts`):

```ts
export class OrderDocument {
  id?: string; // Cosmos documents use lowercase "id"
  customerId?: string;
  status?: string;
  total?: number;
}
```

## Part A — the self-hosted worker

This is the mode with real manual checkpoint control, and the one
[Unified Hosting Model](../hosting.md#cosmos-db-change-feed--usecosmosdbchangefeed) documents in full. Use
`@benzenejs/azure-cosmos-db` for a long-running process you own (a container, an AKS pod, a plain Node
worker).

### 1. Install and wire the consumer

```bash
npm install @benzenejs/azure-cosmos-db @benzenejs/self-host @benzenejs/core-middleware \
  @benzenejs/abstractions @azure/cosmos
```

`useCosmosDbChangeFeed<TDocument>(workers, config, processorFactory, action)` is a free function taking
the worker startup first. Its third argument is an `ICosmosChangeFeedProcessorFactory<TDocument>` — the
built-in `CosmosChangeFeedProcessorFactory` takes the monitored container and an
`ICosmosChangeFeedCheckpointStore` (where the continuation-token checkpoint is persisted). Create
`src/worker.ts`:

```ts
import { CosmosClient } from '@azure/cosmos';
import { useStream } from '@benzenejs/core-middleware';
import {
  BenzeneCosmosChangeFeedConfig,
  CosmosChangeFeedProcessorFactory,
  InMemoryCosmosChangeFeedCheckpointStore,
  useCosmosDbChangeFeed,
} from '@benzenejs/azure-cosmos-db';
import { InlineSelfHostedStartUp } from '@benzenejs/self-host';
import { OrderDocument } from './OrderDocument.js';

const container = new CosmosClient(process.env.COSMOS_CONNECTION_STRING!)
  .database('shop')
  .container('orders');

const worker = new InlineSelfHostedStartUp()
  .configure((workers) =>
    useCosmosDbChangeFeed<OrderDocument>(
      workers,
      new BenzeneCosmosChangeFeedConfig(),
      new CosmosChangeFeedProcessorFactory<OrderDocument>(
        container,
        // Dev/test only — production needs a durable checkpoint store (see below).
        new InMemoryCosmosChangeFeedCheckpointStore(),
      ),
      (feed) =>
        useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>) => {
          for await (const order of documents) {
            // ...in change-feed order for the partition-key range
            console.log('changed order', order.id, order.status);
          }
        }),
    ),
  )
  .build();

await worker.startAsync();
process.on('SIGTERM', () => void worker.stopAsync());
```

`useStream` is the terminal step; because these are ordinary Benzene middleware pipelines, you can put
correlation, metrics, or exception-handling middleware in front of it on the same builder.

> **The checkpoint store is yours in production.** `InMemoryCosmosChangeFeedCheckpointStore` is **not
> durable** — tokens live only for the process's lifetime, so a restart resumes from the config's
> `startFrom` (default "now") rather than the last processed change. It exists as a batteries-included
> reference for dev, tests, and examples. A production worker supplies its own
> `ICosmosChangeFeedCheckpointStore` backed by a Cosmos container, blob, or table.
>
> **Port note.** `@azure/cosmos` has no push-model Change Feed Processor (the .NET SDK does), only a
> pull-model iterator. The port realizes the "processor" by driving that iterator in a poll loop and
> persisting the continuation token through your checkpoint store — so there's no lease-based
> load-balancing across instances; it's a single-consumer poll loop. See the README "Porting conventions"
> change-feed-processor fork note.

### 2. Windowing and aggregation

Because the batch arrives as one stream, a handler can aggregate across it instead of processing
document-by-document — e.g. collapsing multiple updates to the same order into one downstream write:

```ts
(feed) =>
  useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>) => {
    const latestByOrder = new Map<string, OrderDocument>();
    for await (const order of documents) {
      latestByOrder.set(order.id!, order); // later changes overwrite earlier ones
    }
    for (const order of latestByOrder.values()) {
      await projection.upsertAsync(order);
    }
  })
```

This works *because* the feed guarantees you see changes to a given document in order (within its
partition-key range) — the last one wins.

### 3. Checkpointing and failure handling

`BenzeneCosmosChangeFeedConfig` covers what Benzene decides. Construct it with an overrides object:

```ts
new BenzeneCosmosChangeFeedConfig({ autoCheckpointOnSuccess: true, catchHandlerExceptions: false });
```

- **`autoCheckpointOnSuccess`** (default `true`) — checkpoint the batch automatically after the pipeline
  completes successfully, matching the trigger's checkpoint-on-return behaviour, so a handler that never
  thinks about checkpointing gets sensible at-least-once semantics for free. Set `false` for fully manual
  control: the batch is then only checkpointed when the handler calls
  `context.checkpointer.checkpointAsync(...)` itself (the whole-context `useStream` overload gives you the
  `StreamContext`, whose `checkpointer` is real here).
- **`catchHandlerExceptions`** (default `false`) — by default a pipeline exception propagates to the
  processor, which does **not** advance the checkpoint and redelivers the same batch (platform-native
  at-least-once). Note this default is the *opposite* of the Event Hub worker's: the change feed retries a
  failed batch natively, so a reliably-failing batch retries **forever** under the default. Either handle
  poison documents inside the pipeline, or set `catchHandlerExceptions: true` to log-checkpoint-continue
  (permanently skipping the poison batch).

There is no dead-letter concept and no per-document retry: a document that reliably throws poisons its
whole batch. Catch and route irrecoverable documents yourself (e.g. write them to a quarantine container)
rather than letting the exception escape.

### 4. All versions and deletes

The standard (latest-version) change feed delivers only creates and updates — **not deletes**. For deletes
and intermediate versions, use the sibling `useCosmosDbAllVersionsChangeFeed(...)`: its stream is over
`CosmosChangeFeedItem<OrderDocument>` (the document's `current` state, its `previous` state when retention
captured it, and a `changeType` — `CosmosChangeType.Create` / `Replace` / `Delete`) instead of the bare
document, and its config is `BenzeneCosmosAllVersionsChangeFeedConfig`:

```ts
import {
  BenzeneCosmosAllVersionsChangeFeedConfig,
  CosmosChangeFeedItem,
  CosmosChangeType,
  useCosmosDbAllVersionsChangeFeed,
} from '@benzenejs/azure-cosmos-db';

useCosmosDbAllVersionsChangeFeed<OrderDocument>(
  workers,
  new BenzeneCosmosAllVersionsChangeFeedConfig(),
  processorFactory,
  (feed) =>
    useStream<CosmosChangeFeedItem<OrderDocument>>(
      feed,
      async (items: AsyncIterable<CosmosChangeFeedItem<OrderDocument>>) => {
        for await (const item of items) {
          if (item.changeType === CosmosChangeType.Delete) {
            await projection.removeAsync(item.previous?.id ?? item.current.id!);
          } else {
            await projection.upsertAsync(item.current);
          }
        }
      },
    ),
);
```

All-versions-and-deletes is automatic-checkpoint only (no per-batch checkpointer), and it requires the
caller to have configured container/account retention — without it, deletes and intermediate versions
don't surface.

### 5. Testing the worker

The worker's SDK seam is `ICosmosChangeFeedProcessorFactory`, so the whole checkpoint/skip/retry matrix is
testable without a live Cosmos account by faking the factory and driving the delegates the worker hands it
— exactly as `test/Benzene.Core.Test/Azure/CosmosDbWorker/BenzeneCosmosChangeFeedWorkerTest.test.ts` does:

```ts
const config = new BenzeneCosmosChangeFeedConfig();
expect(config.autoCheckpointOnSuccess).toBe(true);
expect(config.catchHandlerExceptions).toBe(false);
```

## Part B — the Azure Functions trigger

For non-manual hosting, `@benzenejs/azure-function-cosmos-db` delivers the same `StreamContext<TDocument>`
pipeline shape behind an Azure Functions `CosmosDBTrigger`. The trigger deliberately carries **no** Azure
SDK dependency — the runtime hands Benzene already-deserialized documents.

### 1. Install and wire

```bash
npm install @benzenejs/azure-function-cosmos-db @benzenejs/azure-function-core \
  @benzenejs/core-middleware @benzenejs/core-message-handlers @benzenejs/abstractions @azure/functions
```

`useCosmosDbChangeFeed<TDocument>(az, action)` configures the pipeline; `handleCosmosDbChanges<TDocument>(host.app,
documents)` dispatches the batch. Write a `StartUp` (the composition root from
[Azure Functions Setup, step 4](../azure-functions.md#4-write-a-startup)), selecting Azure with
`useAzureFunctions(app, az => …)`. Create `src/startUp.ts`:

```ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { useStream } from '@benzenejs/core-middleware';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useCosmosDbChangeFeed } from '@benzenejs/azure-function-cosmos-db';
import { OrderDocument } from './OrderDocument.js';

export class ChangeFeedStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) =>
      useCosmosDbChangeFeed<OrderDocument>(az, (feed) =>
        useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>) => {
          for await (const order of documents) {
            console.log('changed order', order.id, order.status);
          }
        }),
      ),
    );
  }
}
```

Then boot it and expose the trigger handler. Unlike Service Bus and Event Hub, Cosmos DB has **no
`.cosmosDbFunction` host getter** (the same as the Kafka trigger — the change feed's `host.json` binding
has no first-class `@azure/functions` registration helper), so dispatch through the host's built `app` with
`handleCosmosDbChanges(host.app, …)`. Create `src/functions.ts`:

```ts
import { InvocationContext } from '@azure/functions';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import { handleCosmosDbChanges } from '@benzenejs/azure-function-cosmos-db';
import { ChangeFeedStartUp } from './startUp.js';
import { OrderDocument } from './OrderDocument.js';

const changeFeedHost = new AzureFunctionHost(ChangeFeedStartUp);

/** Cosmos DB change-feed trigger: the whole batch arrives as one ordered stream. */
export function ordersChangeFeed(
  documents: OrderDocument[],
  _context: InvocationContext,
): Promise<void> {
  return handleCosmosDbChanges<OrderDocument>(changeFeedHost.app, documents);
}
```

Register it with the `@azure/functions` v4 `app.cosmosDB(...)` binding (`src/registrations.ts`):

```ts
import { app, InvocationContext } from '@azure/functions';
import { ordersChangeFeed } from './functions.js';
import { OrderDocument } from './OrderDocument.js';

app.cosmosDB('ordersChangeFeed', {
  connection: 'CosmosDbConnection',
  databaseName: 'shop',
  containerName: 'orders',
  leaseContainerName: 'leases',
  createLeaseContainerIfNotExists: true,
  handler: (documents: unknown, context: InvocationContext) =>
    ordersChangeFeed(documents as OrderDocument[], context),
});
```

### 2. Where Benzene's responsibility ends on the trigger

| Concern | Owned by |
| --- | --- |
| Batch size, polling interval, lease container, start position | The Functions Cosmos DB extension (`host.json` / the trigger binding) — zero Benzene involvement |
| Lease checkpointing | The trigger: it advances the lease automatically when the callback returns successfully |
| Ordering within the batch | Cosmos (per partition-key range), preserved by Benzene's stream |
| What happens on handler failure | Benzene lets the exception propagate; the trigger does **not** advance the lease and redelivers the whole batch |
| Deletes | Not delivered in the standard change-feed mode — only creates and updates |

The `StreamContext<TDocument>.checkpointer` is the no-op default on the trigger (the Functions binding
exposes no manual checkpoint API) — calling it is harmless but does nothing. Manual per-batch checkpoint
control is the self-hosted worker's domain (Part A).

### 3. Testing the trigger

Boot a `StartUp` into an `AzureFunctionHost` and hand its built app a list — no Cosmos emulator needed,
exactly as `test/Benzene.Core.Test/Azure/CosmosDb/CosmosDbChangeFeedPipelineTest.test.ts` does:

```ts
import { describe, expect, it } from 'vitest';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { useStream } from '@benzenejs/core-middleware';
import { AzureFunctionHost, useAzureFunctions } from '@benzenejs/azure-function-core';
import { handleCosmosDbChanges, useCosmosDbChangeFeed } from '@benzenejs/azure-function-cosmos-db';
import { OrderDocument } from '../src/OrderDocument.js';

describe('orders change feed', () => {
  it('delivers the batch as one ordered stream in a single run', async () => {
    const collected: (string | undefined)[] = [];

    // A local composition root so its stream pipeline closes over `collected`.
    class ChangeFeedStartUp implements BenzeneStartUp {
      configureServices(services: IBenzeneServiceContainer): void {
        addBenzene(services);
      }
      configure(app: IBenzeneApplicationBuilder): void {
        useAzureFunctions(app, (az) =>
          useCosmosDbChangeFeed<OrderDocument>(az, (feed) =>
            useStream<OrderDocument>(feed, async (documents: AsyncIterable<OrderDocument>) => {
              for await (const order of documents) {
                collected.push(order.id);
              }
            }),
          ),
        );
      }
    }

    // Cosmos DB has no `.cosmosDbFunction` host getter (like Kafka) — dispatch through the built app.
    const host = new AzureFunctionHost(ChangeFeedStartUp);
    await handleCosmosDbChanges<OrderDocument>(host.app, [
      Object.assign(new OrderDocument(), { id: 'order-1', status: 'paid' }),
      Object.assign(new OrderDocument(), { id: 'order-2', status: 'shipped' }),
    ]);

    expect(collected).toEqual(['order-1', 'order-2']);
  });
});
```

## Idempotency is non-negotiable

Two platform behaviours make redelivery and duplication a matter of *when*, not *if*, on **both** hosts:

- A failed batch redelivers the **whole batch**, including documents you'd already processed.
- The change feed is itself at-least-once per lease ownership change.

Design every downstream write as an upsert keyed on the document's identity (plus `_ts` or an ETag if you
need to reject stale replays). If your processing has side effects that can't be made naturally idempotent,
put a de-duplication check in front of them — see [Idempotency](idempotency.md).

## See Also

- [Unified Hosting Model](../hosting.md#cosmos-db-change-feed--usecosmosdbchangefeed) — the self-hosted change-feed worker in full
- [Azure Functions Setup](../azure-functions.md#other-triggers) — the trigger table this builds on
- [Event Hub Stream Processing](event-hub-processing.md) — the other Azure fan-in stream
- [Service Bus Message Handling](service-bus-handling.md) — routing by topic instead of streaming
- [Idempotency](idempotency.md) — de-duplication for non-idempotent side effects
- [Testing Benzene](../testing-benzene.md) — `benzeneTestHost(...).buildAzureFunctionApp()` and pipeline tests
- [Azure Cosmos DB change feed](https://learn.microsoft.com/azure/cosmos-db/change-feed) — the platform feature this cookbook consumes
