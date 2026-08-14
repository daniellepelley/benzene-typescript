# Event Hub Stream Processing

Handle high-throughput Azure Event Hubs streams with Benzene, and understand exactly where Benzene's
responsibility ends and the host's begins — under both the Azure Functions trigger and a self-hosted
worker.

## Problem Statement

You're ingesting a high-volume stream through Azure Event Hubs (telemetry, clickstream, change events)
and want to process it with Benzene's message-handler pipeline instead of hand-rolling per-event dispatch.
Doing this well means understanding a few things the [Azure Functions Setup](../azure-functions.md#event-hub)
guide doesn't go into:

- How Benzene actually processes a triggered batch of events internally (sequentially? in parallel? with
  what isolation between events?).
- What Benzene controls about batching, checkpointing, and retries — and what is purely the host's job.
- How the event's routing topic is found, and how it differs between the two hosting modes.
- What happens to a "poison" event that reliably fails, given Event Hubs has no native dead-letter queue
  the way Service Bus does.
- How to reach data on the raw event (partition key, sequence number, custom properties) that never makes
  it into a Benzene message.

As with Service Bus, the port offers two hosting modes — and here they differ in how the routing topic is
carried:

| Host | Package | How the topic is found | Guide |
| --- | --- | --- | --- |
| Azure Functions trigger | `@benzenejs/azure-function-event-hub` | A message **envelope** in each event body (`{ topic, headers, body }`) | [Azure Functions Setup](../azure-functions.md#event-hub) |
| Self-hosted worker | `@benzenejs/azure-event-hub` | A `"topic"` **event property** on each event | [Unified Hosting Model](../hosting.md#ready-made-self-hosted-consumers) |

This cookbook works through both, citing the actual source in `src/Benzene.Azure.Function.EventHub/` and
`src/Benzene.Azure.EventHub/`.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm.
- For the Functions trigger: an Azure Functions v4 project wired up per
  [Azure Functions Setup](../azure-functions.md).
- For the worker: a host process you own — see [Unified Hosting Model](../hosting.md#self-hosted-worker--inlineselfhostedstartup).
- An Event Hubs namespace and event hub, with a connection string.
- Familiarity with the direct-message envelope Benzene uses internally (topic + JSON payload) — see
  [Message Handlers](../message-handlers.md).

## A realistic handler (shared by both hosts)

The handler is transport-agnostic — the *same* one you'd write for any host:

```ts
// src/handlers.ts
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { ITelemetryStore } from './TelemetryStore.js';

export class TelemetryReading {
  deviceId?: string;
  value?: number;
}

export class TelemetryAck {
  accepted?: boolean;
}

@message('telemetry:reading', { requestType: TelemetryReading, responseType: TelemetryAck })
export class TelemetryReadingHandler implements IMessageHandler<TelemetryReading, TelemetryAck> {
  static readonly inject = [ITelemetryStore] as const;

  constructor(private readonly store: ITelemetryStore) {}

  async handleAsync(request: TelemetryReading): Promise<IBenzeneResultOf<TelemetryAck>> {
    await this.store.recordAsync(request.deviceId!, request.value!);
    const ack = new TelemetryAck();
    ack.accepted = true;
    return BenzeneResult.ok(ack);
  }
}
```

`ITelemetryStore` is an injected dependency behind a service token (`src/TelemetryStore.ts`):

```ts
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

export interface ITelemetryStore {
  recordAsync(deviceId: string, value: number): Promise<void>;
}

export const ITelemetryStore: ServiceToken<ITelemetryStore> =
  serviceToken<ITelemetryStore>('ITelemetryStore');
```

## Part A — the Azure Functions Event Hub trigger

### 1. Install and wire the trigger

```bash
npm install @benzenejs/azure-function-event-hub @benzenejs/azure-function-core \
  @benzenejs/core-message-handlers @benzenejs/results @benzenejs/abstractions \
  @benzenejs/abstractions-message-handlers @azure/functions @azure/event-hubs
```

Event Hub events carry no routable topic of their own, so — under the Functions trigger — Benzene reads a
**message envelope** from each event body: the small JSON wrapper `{ "topic": …, "headers": …, "body": … }`
any producer can send (the same envelope shape used for AWS SQS/SNS). `useBenzeneMessage` bridges into a
direct-message pipeline that routes on the envelope's own topic. Write a `StartUp` (the composition root
from [Azure Functions Setup, step 4](../azure-functions.md#4-write-a-startup)), selecting Azure with
`useAzureFunctions(app, az => …)`. Create `src/startUp.ts`:

```ts
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useBenzeneMessage, useEventHub } from '@benzenejs/azure-function-event-hub';
import { TelemetryReadingHandler } from './handlers.js';

export class EventHubStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAzureFunctions(app, (az) =>
      useEventHub(az, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, TelemetryReadingHandler))),
    );
  }
}
```

Then boot it and expose the trigger handler. Importing `@benzenejs/azure-function-event-hub` lights up the
host's `.eventHubFunction` getter. Create `src/functions.ts`:

```ts
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-event-hub';
import { EventHubStartUp } from './startUp.js';

/** Event Hub trigger (batched): each event routes by its embedded envelope topic. */
export const telemetryEventHub = new AzureFunctionHost(EventHubStartUp).eventHubFunction;
```

Register it (`src/registrations.ts`):

```ts
import { app, InvocationContext } from '@azure/functions';
import type { ReceivedEventData } from '@azure/event-hubs';
import { telemetryEventHub } from './functions.js';

app.eventHub('telemetryEventHub', {
  connection: 'EventHubConnection',
  eventHubName: 'telemetry',
  consumerGroup: '%TelemetryConsumerGroup%', // read from configuration, not hardcoded
  cardinality: 'many',
  handler: (events: unknown, context: InvocationContext) =>
    telemetryEventHub(events as ReceivedEventData[], context),
});
```

`consumerGroup` is read from configuration (`%TelemetryConsumerGroup%`) rather than hardcoded, which
matters once more than one consumer reads the same hub — see [Troubleshooting](#partition-and-consumer-group-misconfiguration).

### 2. How Benzene processes a batch — concurrently, each in its own scope

The trigger hands you the whole batch as `ReceivedEventData[]`. It's tempting to assume Benzene loops over
that array one event at a time in partition order. It doesn't. `EventHubApplication` wraps every event in
its own `EventHubContext` and runs them **concurrently via `Promise.all`, each in its own DI scope**, on
the `"event-hub"` transport. Two consequences follow, and both matter for a high-throughput handler:

- **Benzene does not preserve intra-batch ordering**, even though Event Hubs guarantees ordering *within a
  partition* on the wire. If your handler depends on processing events from the same partition in order
  (e.g. applying updates to the same aggregate), you can't rely on the trigger's batch processing to
  preserve it — reduce `maxEventBatchSize` to `1` in `host.json` (at a real throughput cost), or partition
  your own processing by a key you extract from `context.eventData` yourself.
- **A fresh DI scope per event** means scoped services are never shared across two events in the same
  batch. There is no "batch-scoped" aggregation inside a message handler — buffer in your own singleton and
  flush on a threshold/timer if you want one database round trip per batch.

### 3. The envelope your producer must send

`BenzeneMessageEventHubHandler` deserializes each event body into a `{ topic, headers, body }` envelope and
only handles it when `topic` is non-null. So your Event Hub **producer** must publish that envelope shape —
not a bare JSON payload:

```jsonc
{ "topic": "telemetry:reading", "headers": {}, "body": "{\"deviceId\":\"sensor-1\",\"value\":21.5}" }
```

If you publish from a Benzene client (or a test), the `messageBuilder`/`asEventHubBenzeneMessage` helpers
produce this shape for you (see [Testing](#5-testing-the-trigger)). If your producer emits **raw** telemetry
with no envelope, the handler's `canHandle` returns `false` for every event and — because a router that
can't handle a request just falls through — **the event is silently dropped with no error**. For
non-enveloped producers, either wrap at the producer, or reach for the self-hosted worker in
[Part B](#part-b--the-self-hosted-worker), which routes on a plain event **property** instead of an
envelope.

### 4. Reaching data that never makes it into the envelope

`EventHubContext` exposes exactly one thing: the raw `eventData` (a `ReceivedEventData` from
`@azure/event-hubs`). Partition key, sequence number, enqueued time, and any custom `properties` the
producer set are all on that object, but none flow into the handler's request automatically. To use them,
add your own middleware to the Event Hub pipeline, **before** `useBenzeneMessage`:

```ts
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useEventHub, useBenzeneMessage, EventHubContext } from '@benzenejs/azure-function-event-hub';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';

// Inside your StartUp's `configure(app, config)`:
useAzureFunctions(app, (az) =>
  useEventHub(az, (eh) => {
    eh.useFn(async (context: EventHubContext, next) => {
      const schemaVersion = context.eventData.properties?.['schema-version'];
      if (schemaVersion !== undefined && String(schemaVersion) !== '2') {
        // Short-circuit: skip an unsupported-schema event without calling next().
        return;
      }
      await next();
    });
    useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, TelemetryReadingHandler));
  }),
);
```

`properties`, `partitionKey`, `sequenceNumber`, `offset`, and `enqueuedTimeUtc` are all standard
`@azure/event-hubs` `ReceivedEventData` members — nothing Benzene-specific; Benzene hands you the object
untouched.

### 5. Testing the trigger

Turn a `messageBuilder` into a native event whose body is a serialized Benzene envelope with
`asEventHubBenzeneMessage` from `@benzenejs/azure-function-testing`:

```ts
import { describe, expect, it } from 'vitest';
import { benzeneTestHost, messageBuilder } from '@benzenejs/testing';
import { asEventHubBenzeneMessage } from '@benzenejs/azure-function-testing';
import { EventHubStartUp } from '../src/startUp.js';
import { ITelemetryStore } from '../src/TelemetryStore.js';

describe('TelemetryReadingHandler on Event Hub', () => {
  it('processes every event in a batch through the real pipeline', async () => {
    const recorded: string[] = [];
    const store: ITelemetryStore = {
      recordAsync: (deviceId) => { recorded.push(deviceId); return Promise.resolve(); },
    };

    // Boot the same StartUp you deploy, overriding ITelemetryStore with the fake (last-registration-wins).
    const host = benzeneTestHost(EventHubStartUp)
      .withServices((services) => services.addScopedInstance(ITelemetryStore, store))
      .buildAzureFunctionApp();

    // A non-HTTP payload is dispatched fire-and-forget; an array exercises the batched trigger.
    await host.sendEventAsync([
      asEventHubBenzeneMessage(messageBuilder('telemetry:reading', { deviceId: 'sensor-1', value: 21.5 })),
      asEventHubBenzeneMessage(messageBuilder('telemetry:reading', { deviceId: 'sensor-2', value: 22.0 })),
    ]);

    expect(recorded.sort()).toEqual(['sensor-1', 'sensor-2']);
  });
});
```

The host dispatches the batch fire-and-forget through `handleEventHub` (which takes a rest parameter), so
pass a whole batch — an array — to exercise the concurrent fan-out, exactly as
`test/Benzene.Core.Test/Azure/EventHub/EventHubPipelineTest.test.ts` does. In production the same wiring
boots with `new AzureFunctionHost(EventHubStartUp).eventHubFunction`.

### 6. Batching and checkpointing are the runtime's job — and why poison events are hard

Be blunt about this: under the Functions trigger, **Benzene has no API for batch size, prefetch, or
checkpointing**. `EventHubContext` exposes only `eventData`; there is no checkpoint hook. All of it lives in
`host.json`, owned entirely by the Azure Functions Event Hubs extension:

```json
{
  "version": "2.0",
  "extensions": {
    "eventHubs": {
      "maxEventBatchSize": 100,
      "minEventBatchSize": 25,
      "maxWaitTime": "00:00:05",
      "batchCheckpointFrequency": 5,
      "prefetchCount": 300
    }
  }
}
```

And a poison event — one whose payload reliably fails inside your handler — is genuinely awkward here,
because Benzene's own `MessageHandler` **catches handler exceptions and turns them into a failure result**
(`service-unavailable`, or `validation-error` for an argument error) rather than rethrowing. So the
exception does *not* propagate out of `handleEventHub` by default: the callback returns normally, and the
runtime checkpoints the batch as processed. Benzene's result status has no effect on the extension's
retry/checkpoint machinery, which only reacts to a real exception escaping the callback. If you want a
failing event to interact with `host.json`'s retry policy, bridge the gap yourself — inspect the result in
a middleware and rethrow — but remember Event Hubs still has **no dead-letter queue**, so once retries (if
any) are exhausted the event is checkpointed past regardless. Log the raw `eventData` somewhere durable
before deciding to let a failure surface. This is a platform constraint, not a Benzene one.

The self-hosted worker in Part B flips this: there, checkpointing and poison-event handling become
Benzene's, configured rather than worked around.

## Part B — the self-hosted worker

For consuming an event hub from a long-running process you own, use `@benzenejs/azure-event-hub`. The key
inversion from the trigger: **Benzene owns what the runtime owned above** — checkpointing, failure
handling, and the starting position — and routing is by a plain event **property**, not an envelope.

### 1. Install and wire the consumer

```bash
npm install @benzenejs/azure-event-hub @benzenejs/self-host @benzenejs/core-message-handlers \
  @benzenejs/results @benzenejs/abstractions @benzenejs/abstractions-message-handlers @azure/event-hubs
```

```ts
// src/worker.ts
import { EventHubConsumerClient, earliestEventPosition } from '@azure/event-hubs';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import {
  BenzeneEventHubConfig,
  EventProcessorClientFactory,
  useEventHub,
} from '@benzenejs/azure-event-hub';
import { InlineSelfHostedStartUp } from '@benzenejs/self-host';
import { TelemetryReadingHandler } from './handlers.js';
import { ITelemetryStore, TelemetryStore } from './TelemetryStore.js';

const client = new EventHubConsumerClient(
  '$Default',
  process.env.EVENT_HUB_CONNECTION!,
  'telemetry',
);

const config: BenzeneEventHubConfig = {
  checkpointInterval: 25,                        // checkpoint every 25 handled events per partition
  defaultStartingPosition: earliestEventPosition, // only used when a partition has no checkpoint yet
  catchHandlerExceptions: true,                  // the default — skip-and-continue on a handler error
};

const worker = new InlineSelfHostedStartUp()
  .configureServices((services) => services.addScoped(ITelemetryStore, TelemetryStore))
  .configure((workers) =>
    useEventHub(
      workers,
      config,
      new EventProcessorClientFactory(client),
      (pipeline) => useMessageHandlers(pipeline, TelemetryReadingHandler),
    ),
  )
  .build();

await worker.startAsync();
process.on('SIGTERM', () => void worker.stopAsync());
```

The inner pipeline is `useMessageHandlers(...)` — the worker routes each event by its `"topic"` **event
property** (via `EventHubConsumerMessageTopicGetter`), *not* by a body envelope. So a producer sets the
routing topic as an application property on the event; a missing/non-string property yields the `<missing>`
topic id. (Configure a different property key with `topicPropertyKey` on the config.)

### 2. Checkpointing, failure handling, and starting position are yours

`BenzeneEventHubConfig` covers exactly what Benzene decides:

- **`checkpointInterval`** (default 1) — how many successfully handled events a partition accumulates
  before its checkpoint updates. Raise for throughput at the cost of a larger replay window on restart.
- **`catchHandlerExceptions`** (default `true`) — skip-and-continue: log the failed event, keep the
  partition moving, and let a later event checkpoint past it. Set `false` to instead stop the whole worker
  on the first unhandled exception *without* checkpointing the failed event, so a restart redelivers it
  (at-least-once) — the self-hosted answer to the trigger's "no help with poison events".
- **`raiseOnFailureStatus`** (default `true`) — escalate a non-exception failure result into a thrown
  `EventHubMessageProcessingException` so it's treated exactly like an exception (the failed event isn't
  checkpointed). Set `false` for at-most-once (recorded for diagnostics, checkpointed past).
- **`defaultStartingPosition`** — where a fresh consumer group with no checkpoint begins (e.g.
  `earliestEventPosition` to replay the full retained backlog). Once a partition has a checkpoint, that
  checkpoint always wins.

### 3. Testing the worker

The worker's SDK seam is `IEventProcessorClientFactory`, so `EventHubConsumerApplication` is testable
without a live hub — see `test/Benzene.Core.Test/Azure/EventHubWorker/EventHubConsumerTest.test.ts` for
driving the consumer and asserting checkpoint/skip behaviour per config.

## Troubleshooting

### Partition and consumer-group misconfiguration

- **Events never arrive / function never triggers**: check the `connection` on the trigger — it names an
  app setting holding the connection string, not the string itself. A typo fails silently in local dev.
- **Old events re-processed on every restart, or wrong offset**: each distinct consumer group maintains its
  own checkpoint state. Give every distinct consumer its own consumer group, created ahead of time on the
  hub — neither the extension nor the worker creates consumer groups for you.

### Handler never gets invoked, but no error appears

- **On the trigger**: confirm the producer publishes the `{ topic, headers, body }` envelope. A body with a
  null/missing `topic` (or non-JSON) is a normal "not for me" outcome for the router — it defers with no
  exception, no log, no result.
- **On the worker**: confirm the producer sets the `"topic"` event property. A missing property routes to
  `<missing>` and matches no handler.

### A single bad event seems to have no effect, but data was lost

On the trigger, `MessageHandler` converts your handler's exceptions into a `service-unavailable` result
rather than throwing (see [step 6](#6-batching-and-checkpointing-are-the-runtimes-job--and-why-poison-events-are-hard)).
A systematically failing event type can churn through the pipeline indefinitely, checkpointing past every
time, invisibly — unless you've wired logging/diagnostics (`addDiagnostics()` — see
[Monitoring](../monitoring.md)) or the rethrow pattern. On the worker, the default
`catchHandlerExceptions: true` also skips-and-continues; set it `false` for at-least-once.

## See Also

- [Azure Functions Setup](../azure-functions.md#event-hub) — project setup and the Event Hub trigger basics this builds on
- [Unified Hosting Model](../hosting.md#ready-made-self-hosted-consumers) — the self-hosted worker model
- [Service Bus Message Handling](service-bus-handling.md) — the analogous cookbook for Service Bus
- [Cosmos DB Change Feed Processing](cosmos-change-feed-processing.md) — the other Azure fan-in stream
- [Message Handlers](../message-handlers.md) — `@message`, handler discovery, and the Benzene message envelope
- [Testing Benzene](../testing-benzene.md) — `benzeneTestHost(...).buildAzureFunctionApp()` and the Azure test helpers
- [Azure Event Hubs host.json reference](https://learn.microsoft.com/azure/azure-functions/functions-bindings-event-hubs) — the runtime-side batching/checkpointing settings this cookbook references
