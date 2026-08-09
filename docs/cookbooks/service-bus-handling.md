# Service Bus Message Handling

Process Azure Service Bus queue and topic/subscription messages with Benzene, using the same
`@message`/topic-routing model as HTTP and Kafka — either behind an Azure Functions trigger or in a
long-running worker you own.

## Problem Statement

You're consuming messages from an Azure Service Bus queue (or a topic/subscription) and want to route
them to Benzene message handlers by topic, the same way HTTP requests and Kafka records are routed,
rather than hand-rolling per-message dispatch. Doing this well means understanding a few things the
[Azure Functions Setup](../azure-functions.md#service-bus) guide only introduces briefly:

- Where the "topic" used for handler routing actually comes from, since a Service Bus queue or
  topic/subscription is a routing *destination*, not a per-message topic field.
- How headers reach your handler, and what values get filtered out.
- What Benzene does when a handler fails — and, importantly, which of the two hosting modes actually
  settles (completes/abandons) a message from the handler's outcome.
- How to process a single message vs. a batch.

The TypeScript port gives you **two** ways to consume Service Bus, and they differ exactly on that last
point:

| Host | Package | Who settles the message | Guide |
| --- | --- | --- | --- |
| Azure Functions trigger | `@benzene/azure-function-service-bus` | The Functions host (auto-complete) | [Azure Functions Setup](../azure-functions.md#service-bus) |
| Self-hosted worker | `@benzene/azure-service-bus` | Benzene, from the handler's outcome | [Unified Hosting Model](../hosting.md#ready-made-self-hosted-consumers) |

This cookbook works through both, citing the actual source in `src/Benzene.Azure.Function.ServiceBus/`
and `src/Benzene.Azure.ServiceBus/`.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm.
- For the Functions trigger: an Azure Functions v4 project wired up per
  [Azure Functions Setup](../azure-functions.md), steps 1–7 (`azureApp` helper, `host.json`,
  `local.settings.json`).
- For the worker: a host process you own (a container, an AKS pod, a plain Node process) — see
  [Unified Hosting Model](../hosting.md#self-hosted-worker--inlineselfhostedstartup).
- A Service Bus namespace with a queue (or topic/subscription), and a connection string.
- Familiarity with `@message`/handler registration — see [Message Handlers](../message-handlers.md).

## A realistic handler (shared by both hosts)

The whole point of routing Service Bus by topic is that the handler is the *same* one you'd write for
any other transport — it knows nothing about Service Bus. Create `src/handlers.ts`:

```ts
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { IOrderStore } from './OrderStore.js';

// Payloads are classes, not interfaces: the runtime recovers the erased request type from its
// constructor (for topic/schema keying), which an interface can't provide.
export class CreateOrderRequest {
  orderId?: string;
}

export class CreateOrderResponse {
  accepted?: boolean;
}

@message('order:create', { requestType: CreateOrderRequest, responseType: CreateOrderResponse })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, CreateOrderResponse> {
  static readonly inject = [IOrderStore] as const;

  constructor(private readonly store: IOrderStore) {}

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<CreateOrderResponse>> {
    await this.store.saveAsync(request.orderId!);
    const response = new CreateOrderResponse();
    response.accepted = true;
    return BenzeneResult.ok(response);
  }
}
```

`IOrderStore` is an injected dependency — an interface with a merged `ServiceToken` constant of the same
name (`src/OrderStore.ts`):

```ts
import { ServiceToken, serviceToken } from '@benzene/abstractions';

export interface IOrderStore {
  saveAsync(orderId: string): Promise<void>;
}

export const IOrderStore: ServiceToken<IOrderStore> = serviceToken<IOrderStore>('IOrderStore');
```

See [Message Handlers](../message-handlers.md) for the `@message`/`static inject` convention and
[Mocking External Dependencies](mocking-dependencies.md) for faking `IOrderStore` in tests.

## Part A — the Azure Functions Service Bus trigger

### 1. Build the app and wire the trigger callback

Install the trigger package alongside the Azure Functions core packages from
[Azure Functions Setup](../azure-functions.md#2-install-the-packages):

```bash
npm install @benzene/azure-function-service-bus @benzene/azure-function-core \
  @benzene/core-message-handlers @benzene/results @benzene/abstractions \
  @benzene/abstractions-message-handlers @azure/functions @azure/service-bus
```

`useServiceBus(app, action, configure?)` configures the pipeline; `handleServiceBusMessages(app,
...messages)` dispatches. It takes a rest parameter, so the same function serves a single-message
trigger and a batched (`cardinality: 'many'`) one. Reusing the `azureApp` helper from
[Azure Functions Setup, step 4](../azure-functions.md#4-build-the-benzene-app), create `src/functions.ts`:

```ts
import { InvocationContext } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { handleServiceBusMessages, useServiceBus } from '@benzene/azure-function-service-bus';
import { azureApp } from './azureApp.js';
import { CreateOrderHandler } from './handlers.js';

const serviceBusApp = azureApp((app) =>
  useServiceBus(app, (sb) => useMessageHandlers(sb, CreateOrderHandler)),
);

/** Service Bus trigger: each message routes by its `topic` application property. */
export function orderQueue(
  messages: ServiceBusReceivedMessage[],
  _context: InvocationContext,
): Promise<void> {
  return handleServiceBusMessages(serviceBusApp, ...messages);
}
```

Register it with the `@azure/functions` v4 API at module load (`src/registrations.ts`):

```ts
import { app, InvocationContext } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { orderQueue } from './functions.js';

app.serviceBusQueue('orderQueue', {
  connection: 'ServiceBusConnection',
  queueName: 'orders',
  cardinality: 'many', // batched: the callback receives an array of messages
  handler: (messages: unknown, context: InvocationContext) =>
    orderQueue(messages as ServiceBusReceivedMessage[], context),
});
```

A topic/subscription reads identically — swap `app.serviceBusQueue` for `app.serviceBusTopic` with
`topicName`/`subscriptionName`. Nothing in Benzene distinguishes a queue from a subscription; both hand
the callback `ServiceBusReceivedMessage[]`.

### 2. Where the topic comes from

A Service Bus queue, or a topic/subscription pair, is a routing *destination* configured on the trigger
— it isn't a per-message field the way a Kafka record's topic is. Reading
`ServiceBusMessageTopicGetter`, Benzene takes the routing topic from a custom `"topic"` **application
property** on the message (the same convention `@benzene/aws-lambda-sqs` uses for SQS message
attributes):

```ts
const value = context.message.applicationProperties?.['topic'];
return typeof value === 'string' ? value : undefined;
```

Your **sender** has to set it explicitly. With `@azure/service-bus`:

```ts
await sender.sendMessages({
  body: { orderId: 'o-123' },
  applicationProperties: { topic: 'order:create' },
});
```

If the property is missing (or isn't a string), `getTopic` returns the `<missing>` topic id, `MessageRouter`
returns a validation-error result, and nothing routes — see [Troubleshooting](#message-never-reaches-a-handler).

### 3. Headers, and what gets filtered out

Service Bus application properties are `Record<string, unknown>` — the broker allows numeric, boolean, and
other primitive values, not just strings. `ServiceBusMessageHeadersGetter` exposes only the **string-typed**
ones as Benzene headers:

```ts
for (const [key, value] of Object.entries(properties)) {
  if (typeof value === 'string') {
    headers[key] = value;
  }
}
```

A numeric retry count or a boolean flag is silently excluded (not stringified). Read those directly off
`context.message.applicationProperties` in your own middleware if you need them.

### 4. Failure handling on the trigger

This is the part worth being precise about, because it differs from the .NET original. The TypeScript
`@benzene/azure-function-service-bus` package does **not** expose per-message
`complete`/`abandon` control — there is no `AckMode` and no `ServiceBusMessageActions` binding. On the
Functions trigger, **the Functions host settles the message**: it auto-completes each message once your
callback returns without throwing, governed entirely by the trigger's own `host.json` configuration
(`maxAutoLockRenewalDuration`, `maxConcurrentCalls`, the entity's max-delivery-count and dead-letter
settings), independent of whatever your handler returns.

What Benzene *does* give you is `ServiceBusOptions`, passed as the optional third argument to
`useServiceBus`. Both flags default to `false`:

```ts
useServiceBus(
  app,
  (sb) => useMessageHandlers(sb, CreateOrderHandler),
  (options) => {
    options.catchExceptions = true;    // default false
    options.raiseOnFailureStatus = true; // default false
  },
);
```

- **`catchExceptions`** — by default (`false`) a handler exception cascades out of the batch and fails the
  whole trigger invocation, so the Functions host's retry policy sees it (and abandons/redelivers per the
  entity's settings). Set it `true` to instead catch and log each message's exception so one bad message
  in a batch doesn't fail the others.
- **`raiseOnFailureStatus`** — by default (`false`) a handler that returns a non-exception *failure result*
  (e.g. `BenzeneResult.serviceUnavailable(...)`) is silently accepted and the message auto-completes. Set
  it `true` to escalate a failure result into a thrown `ServiceBusMessageProcessingException`, so it's
  treated the same as an unhandled exception for the host's retry purposes.

Each message in the batch runs concurrently, in its own DI scope, on the `"service-bus"` transport (from
`ServiceBusBatchApplication`).

> **Want settlement tied to the handler's outcome?** That's the self-hosted worker's job — see
> [Part B](#part-b--the-self-hosted-worker). If you need per-message complete/abandon under Azure
> Functions specifically, bind `ServiceBusMessageActions` in your own callback and act on it yourself;
> the Benzene trigger package doesn't do it for you.

### 5. Testing the trigger

You don't need a real broker. Build the same app your `azureApp` helper does, turn a `messageBuilder`
into a native `ServiceBusReceivedMessage` with `asAzureServiceBusMessage` from
`@benzene/azure-function-testing`, and invoke the callback directly:

```ts
import { describe, expect, it } from 'vitest';
import { messageBuilder } from '@benzene/testing';
import { asAzureServiceBusMessage } from '@benzene/azure-function-testing';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { InlineAzureFunctionStartUp } from '@benzene/azure-function-core';
import { handleServiceBusMessages, useServiceBus } from '@benzene/azure-function-service-bus';
import { CreateOrderHandler } from '../src/handlers.js';
import { IOrderStore } from '../src/OrderStore.js';

describe('CreateOrderHandler on Service Bus', () => {
  it('routes each message in a batch to the handler by its topic property', async () => {
    const saved: string[] = [];
    const store: IOrderStore = { saveAsync: (id) => { saved.push(id); return Promise.resolve(); } };

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => {
        addBenzene(services);
        services.addScopedInstance(IOrderStore, store);
      })
      .configure((builder) => useServiceBus(builder, (sb) => useMessageHandlers(sb, CreateOrderHandler)))
      .build();

    // asAzureServiceBusMessage puts the topic (and every header) on applicationProperties.
    await handleServiceBusMessages(
      app,
      asAzureServiceBusMessage(messageBuilder('order:create', { orderId: 'o-1' })),
      asAzureServiceBusMessage(messageBuilder('order:create', { orderId: 'o-2' })),
    );

    expect(saved.sort()).toEqual(['o-1', 'o-2']);
  });
});
```

`handleServiceBusMessages` takes a rest parameter, so pass one message for a non-batched trigger or many
to exercise a batched one — exactly as `test/Benzene.Core.Test/Azure/ServiceBus/ServiceBusPipelineTest.test.ts`
does. See [Testing Benzene](../testing-benzene.md) for the full picture.

## Part B — the self-hosted worker

When you'd rather consume Service Bus from a long-running process you own (a container, an AKS pod, a
plain Node worker) with no Functions runtime at all, use `@benzene/azure-service-bus`. Here **Benzene owns
the process, the concurrency, and — crucially — the settlement**.

### 1. Install and wire the consumer

```bash
npm install @benzene/azure-service-bus @benzene/self-host @benzene/core-message-handlers \
  @benzene/results @benzene/abstractions @benzene/abstractions-message-handlers @azure/service-bus
```

`useServiceBus(workers, config, clientFactory, action)` is a free function taking the worker startup
first (the same builder-first shape as every other `use*`). You build the `ServiceBusClient`, so
authentication (connection string, managed identity, or the local emulator) is entirely yours. Create
`src/worker.ts`:

```ts
import { ServiceBusClient } from '@azure/service-bus';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import {
  BenzeneServiceBusConfig,
  ServiceBusClientFactory,
  ServiceBusConsumerAckMode,
  useServiceBus,
} from '@benzene/azure-service-bus';
import { InlineSelfHostedStartUp } from '@benzene/self-host';
import { CreateOrderHandler } from './handlers.js';
import { OrderStore } from './OrderStore.js';
import { IOrderStore } from './OrderStore.js';

const client = new ServiceBusClient(process.env.SERVICE_BUS_CONNECTION!);

const config: BenzeneServiceBusConfig = {
  queueName: 'orders',
  maxConcurrentCalls: 5,
  ackMode: ServiceBusConsumerAckMode.Explicit, // the default — shown for clarity
};

const worker = new InlineSelfHostedStartUp()
  .configureServices((services) => services.addScoped(IOrderStore, OrderStore))
  .configure((workers) =>
    useServiceBus(
      workers,
      config,
      new ServiceBusClientFactory(client),
      (pipeline) => useMessageHandlers(pipeline, CreateOrderHandler),
    ),
  )
  .build();

await worker.startAsync();

// Keep the process alive; drain in-flight work on shutdown.
process.on('SIGTERM', () => void worker.stopAsync());
```

The `useServiceBus` call registers Benzene's base services and the consumer's own getters itself, so a
worker that only hosts ready-made consumers needs no `addBenzene` step. Register a topic/subscription
instead of a queue by setting `topicName` + `subscriptionName` on the config in place of `queueName`.

### 2. Settlement is a first-class option here

Unlike the Functions trigger, the worker settles each message itself, driven by `ackMode` on
`BenzeneServiceBusConfig`:

- **`ServiceBusConsumerAckMode.Explicit`** (the **default**) — Benzene completes the message after a
  successful outcome and **abandons** it after a failed one: either a thrown exception *or* a non-exception
  failure result (`isSuccessful === false`). An abandoned message is returned to the queue, subject to the
  entity's lock duration, max-delivery-count, and dead-letter settings. The worker turns the receiver's
  auto-complete off itself.
- **`ServiceBusConsumerAckMode.AutoComplete`** — the receiver's own auto-complete applies: a message
  completes once the handler returns without throwing, and is abandoned only when the handler *throws*. A
  returned failure result still completes in this mode. Opt into this only if a returned failure should
  not keep the message.

So on the worker, a `BenzeneResult.serviceUnavailable(...)` from `CreateOrderHandler` abandons the message
for redelivery out of the box, no extra wiring — the self-hosted equivalent of the per-message control the
Functions trigger doesn't offer.

### 3. Concurrency and long-running handlers

- **`maxConcurrentCalls`** (default 5) is the receiver's own cap on how many messages run at once — there's
  no `host.json` and no Functions scale controller; this is your concurrency knob.
- **`maxAutoLockRenewalDurationInMs`** (SDK default 5 minutes) is how long the receiver keeps renewing a
  message's lock while a handler runs. Raise it for handlers that can legitimately run longer than the
  entity's lock duration.
- **Sessions** — set `sessionsEnabled: true` (with `maxConcurrentSessions` / `maxConcurrentCallsPerSession`)
  to consume a session-enabled entity with per-session FIFO ordering. The entity must be created
  session-enabled and producers must set a session id. This is a TypeScript-port bend over the SDK's
  one-session-at-a-time `acceptNextSession` primitive — see the `sessionsEnabled` note on
  `BenzeneServiceBusConfig` and the README "Porting conventions".

### 4. Testing the worker

The worker's SDK-facing seam is `IServiceBusClientFactory`, so the consumer application is testable
without a live broker by driving `ServiceBusConsumerApplication` directly — exactly as
`test/Benzene.Core.Test/Azure/ServiceBusWorker/ServiceBusConsumerTest.test.ts` does. That test file is the
best reference for asserting the complete/abandon decision per `ackMode`.

## Troubleshooting

### Message never reaches a handler

If the `"topic"` application property is missing or isn't a string, the topic getter returns the
`<missing>` id and `MessageRouter` returns a validation-error result instead of dispatching. Confirm your
sender actually sets `applicationProperties: { topic: '…' }` (a missing property is easy to miss when the
send call itself doesn't fail). If the producer isn't a Benzene client and can't set the property, give the
pipeline a fixed topic with `usePresetTopic` (from `@benzene/core-message-handlers`) — see
[Common Middleware](../common-middleware.md).

### Handler runs but the message keeps redelivering (or never does)

- **On the Functions trigger**, completion/abandon/redelivery is entirely the trigger's own configuration
  (`host.json`), disconnected from what your handler returns — unless you set `raiseOnFailureStatus: true`
  (a failure result then fails the invocation) or `catchExceptions: true` (an exception no longer fails it).
- **On the worker**, this *is* handler-driven under the default `Explicit` ack mode. If a message keeps
  redelivering, the handler is returning a failure result (or throwing) every time — check the entity's
  max-delivery-count so it eventually dead-letters instead of retrying forever. If it *never* redelivers on
  failure, you've set `ackMode: ServiceBusConsumerAckMode.AutoComplete`, under which a returned failure
  result still completes.

### A non-HTTP trigger never fires locally

Every Azure Functions trigger except HTTP needs `AzureWebJobsStorage` to be a real connection, plus the
trigger's own `ServiceBusConnection` setting pointing at a real namespace or emulator. See the
[Azure Functions troubleshooting](../azure-functions.md#troubleshooting) notes.

## See Also

- [Azure Functions Setup](../azure-functions.md#service-bus) — project setup and the Service Bus trigger basics this builds on
- [Unified Hosting Model](../hosting.md#ready-made-self-hosted-consumers) — the self-hosted worker model and its ready-made consumers
- [Event Hub Stream Processing](event-hub-processing.md) — the analogous cookbook for Event Hubs
- [Message Handlers](../message-handlers.md) — `@message`, `IMessageHandler`, and `static inject`
- [Message Result](../message-result.md) — the `BenzeneResult` factory and its statuses
- [Mocking External Dependencies](mocking-dependencies.md) — faking `IOrderStore` in vitest
- [Testing Benzene](../testing-benzene.md) — `InlineAzureFunctionStartUp` and the Azure test helpers
- [Azure Service Bus messages, payloads, and serialization](https://learn.microsoft.com/azure/service-bus-messaging/service-bus-messages-payloads) — application properties, the field this cookbook routes on
