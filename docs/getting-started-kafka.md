# Getting Started: Benzene as a Kafka Worker

Benzene runs your message handlers as a **self-hosted Kafka consumer-group worker** — a long-running
process that owns its own consumer group, subscribes to topics, and dispatches each record through the
same middleware pipeline your handlers use on every other transport. This guide starts from an empty
folder and ends with a running worker consuming a topic, then adds the health-check and producer
surfaces once the basics are in place.

If you're brand new to Benzene, read [Getting Started](getting-started.md) first. The message handler
you write there runs unchanged here; only the host differs, and that's what this guide covers.

> **TypeScript port.** `@benzenejs/kafka-core` is the port of the consumer-worker slice of the .NET
> `Benzene.Kafka.Core`, built on [kafkajs](https://kafka.js.org/). It is the **standalone worker** —
> distinct from the AWS Lambda MSK trigger (`@benzenejs/aws-lambda-kafka`) and the Azure Functions Kafka
> trigger (`@benzenejs/azure-function-kafka`), which process records delivered by a cloud trigger rather
> than consuming a broker directly. Where the port diverges from .NET (the config bag holds no broker
> settings; the caller builds the kafkajs `Consumer`), the code comments and this guide call it out.

**Worth using even if Kafka is the only transport this service ever has.** Unlike HTTP, where Express
already gives you routing for free (see
[Why not just Express?](getting-started.md#why-not-just-express)), kafkajs's `consumer.run` on its own
hands you a raw record and stops — dispatching on whatever identifies its type, and every cross-cutting
concern (validation, retries, structured logging) is code you'd otherwise write yourself in the
`eachMessage` callback. `useKafka` + the middleware pipeline is that missing layer, for Kafka
specifically — the same reasoning applies to `@benzenejs/aws-sqs`, this port's self-hosted SQS poller.

## What you'll build

A long-running worker process that joins a Kafka consumer group, consumes a `hello_world` topic, and
routes each record to an ordinary Benzene message handler — plus a reachability health check and an
outbound producer once the basics run.

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and npm
- Any editor
- A Kafka broker to develop against — a local single-broker cluster (for example via
  [Confluent's Docker images](https://hub.docker.com/r/confluentinc/cp-kafka) reachable at
  `localhost:9092`) is enough

## The core idea in 30 seconds

Benzene separates *what your service does* from *how it's invoked*:

- A **message handler** contains your logic. It receives a typed request and knows nothing about Kafka,
  consumer groups, or offsets.
- Each handler is mapped to a **topic** via the `@message` decorator. On Kafka the topic string is the
  **literal Kafka topic name** — there is no colon-separated topic-id convention the way there is for
  HTTP. Whatever you pass to `@message('...')` must be exactly the Kafka topic the record arrives on.
- The **worker** connects a kafkajs consumer, subscribes to the configured topics, and runs each record
  through the pipeline, which routes it to the matching handler by topic.

Kafka records are fire-and-forget — nothing is written back to the broker — so a Kafka handler is
usually an `IMessageHandlerNoResponse<TRequest>`. See [Message Handlers](message-handlers.md) and
[Middleware](middleware.md) for the full picture.

## 1. Create the project

```bash
mkdir orders-worker && cd orders-worker
npm init -y
npm pkg set type=module
```

Setting `type=module` makes this an ES-module project, which Benzene's packages require.

## 2. Install the packages

> The `@benzenejs/*` packages aren't published to npm yet — see the
> [pre-release note](getting-started.md) for how to work from the cloned workspace or `file:`
> dependencies in the meantime.

```bash
npm install @benzenejs/kafka-core @benzenejs/self-host @benzenejs/core-message-handlers kafkajs
```

- `@benzenejs/kafka-core` is the worker itself: `useKafka`, `BenzeneKafkaWorker`, the record mappers, the
  outbound producer client, and the health check.
- `@benzenejs/self-host` is the platform-neutral worker host — `InlineSelfHostedStartUp` builds a runnable
  worker from your wiring.
- `@benzenejs/core-message-handlers` provides the `@message` decorator and `useMessageHandlers`.
- `kafkajs` is the underlying client; **you** construct the `Kafka` client and `Consumer`, so it's a
  direct dependency.

## 3. Write a message handler

Create `src/handlers.ts`. This is your logic — the file you'd carry over verbatim to any other
transport:

```ts
import { IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';

// Payloads are classes, not interfaces: the runtime recovers the erased request type from its
// constructor (for topic/schema keying), which an interface can't provide.
export class HelloWorldMessage {
  name?: string;
}

// The @message topic must be the LITERAL Kafka topic name — not a colon-separated id.
@message('hello_world', { requestType: HelloWorldMessage })
export class HelloWorldMessageHandler implements IMessageHandlerNoResponse<HelloWorldMessage> {
  handleAsync(message: HelloWorldMessage): Promise<void> {
    console.log(`Hello ${message.name}!`);
    return Promise.resolve();
  }
}
```

`IMessageHandlerNoResponse<TRequest>` is the right shape for a fire-and-forget Kafka record — there's no
response type because nothing is written back to the broker. `requestType` gives the runtime the
concrete class it needs to bind the record's JSON value (TypeScript erases generics, so it can't be
inferred). See [Message Handlers](message-handlers.md) for the request/response shape if the same
handler also serves another transport.

## 4. Configure and start the worker

Create `src/index.ts`. This is the only file that knows it's running on Kafka. Unlike the .NET config
bag, `BenzeneKafkaConfig` carries **no broker or group-id settings** — those live on the kafkajs
`Consumer` you build and hand to a `KafkaConsumerFactory`:

```ts
import { Kafka } from 'kafkajs';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { InlineSelfHostedStartUp } from '@benzenejs/self-host';
import { KafkaConsumerFactory, useKafka } from '@benzenejs/kafka-core';
import { HelloWorldMessageHandler } from './handlers.js';

// You build the kafkajs client + consumer: brokers live on the Kafka client, groupId on the consumer.
const kafka = new Kafka({ clientId: 'orders-worker', brokers: ['localhost:9092'] });
const consumer = kafka.consumer({ groupId: 'orders-worker' });

const worker = new InlineSelfHostedStartUp()
  .configure((app) =>
    useKafka(
      app,
      { topics: ['hello_world'], fromBeginning: true },
      new KafkaConsumerFactory(consumer),
      (kafka) => useMessageHandlers(kafka, HelloWorldMessageHandler),
    ),
  )
  .build();

await worker.startAsync();

// Stop consuming and drain the in-flight handler on shutdown.
process.on('SIGINT', () => void worker.stopAsync());
process.on('SIGTERM', () => void worker.stopAsync());
```

What each step does:

- `new Kafka({ brokers }).consumer({ groupId })` builds the kafkajs consumer. The **caller** owns all
  connection detail — brokers, group id, SASL/SSL, OAUTHBEARER — and `KafkaConsumerFactory` just hands
  that ready consumer to the worker, which only subscribes, runs, commits, and disconnects it.
- `useKafka(app, config, consumerFactory, action)` registers the worker plus the record mappers that
  adapt a kafkajs record to the pipeline. Inside the `action`, `useMessageHandlers(kafka, ...)` routes a
  matched record to its handler — pass every handler class you want served.
- `InlineSelfHostedStartUp().build()` returns a runnable worker; `await worker.startAsync()` connects,
  subscribes, and begins consuming in the background (it does **not** block until shutdown).
  `worker.stopAsync()` disconnects the consumer, which waits for the in-flight handler to finish.

Run it:

```bash
npx tsx src/index.ts
```

Publish a record to the `hello_world` topic (from any producer) with a JSON value like
`{"name":"World"}` and the worker prints `Hello World!`.

## 5. Configuration reference

`BenzeneKafkaConfig` carries only what Benzene itself decides — the topics and the processing behaviour.
All fields except `topics` are optional; the defaults below are applied by `withKafkaConfigDefaults`:

| Field | Default | Meaning |
|---|---|---|
| `topics` | *(required)* | The topics the worker subscribes to (kafkajs `consumer.subscribe({ topics })`). |
| `fromBeginning` | kafkajs default (new records only) | Set `true` to process the retained backlog on first run. |
| `concurrentRequests` | `5` | Max partitions handled concurrently (`partitionsConsumedConcurrently`). |
| `preserveOrderPerPartition` | `true` | A partition's records are handled in order — inherent to kafkajs's `eachMessage` model. |
| `catchHandlerExceptions` | `true` | Catch a handler exception, log it, and keep consuming. Set `false` to stop the worker on the first unhandled exception. |
| `commitOnlyOnSuccess` | `false` | Commit an offset only after its record's handler succeeds (at-least-once). Requires `catchHandlerExceptions = false` and `preserveOrderPerPartition = true` — enforced at startup. |

> **At-least-once processing.** Set `commitOnlyOnSuccess: true` (with `catchHandlerExceptions: false`)
> to redeliver a record whose handler fails or whose worker crashes mid-handling, instead of relying on
> kafkajs's periodic auto-commit. The worker commits `record.offset + 1` after each successful handle.

## 6. Add a reachability health check

`useKafka` can auto-wire a read-only Kafka reachability check — it verifies the brokers are reachable
and every subscribed topic exists, using a metadata probe (`admin.describeCluster` +
`admin.fetchTopicMetadata`). Because `BenzeneKafkaConfig` holds no broker settings, the check needs its
own admin-client seam: pass a `KafkaAdminClientFactory` (built from the same `Kafka` client, plus the
bootstrap-servers string it should report) as the fifth argument to `useKafka`:

```ts
import { KafkaAdminClientFactory, KafkaConsumerFactory, useKafka } from '@benzenejs/kafka-core';

useKafka(
  app,
  { topics: ['hello_world'] },
  new KafkaConsumerFactory(consumer),
  (kafka) => useMessageHandlers(kafka, HelloWorldMessageHandler),
  new KafkaAdminClientFactory(kafka, 'localhost:9092'), // enables the health check
);
```

The check registers on the **dependency** category (the deep `healthcheck` layer only — never a
Kubernetes liveness probe), deduped by the bootstrap servers. It is a **no-op unless an admin factory
is supplied**; a sixth `healthCheck` argument (default `true`) lets you opt out even when a factory is
given. An authorization failure is reported as a persistent failure, since a bad credential or ACL
won't self-heal.

## 7. Producing messages

To send Kafka messages from another Benzene service — so business logic depends only on the
transport-agnostic client surface — wrap a kafkajs `Producer` in a `KafkaBenzeneMessageClient` and call
`sendMessageAsync`:

```ts
import { Kafka } from 'kafkajs';
import { sendMessageAsync } from '@benzenejs/clients';
import { KafkaBenzeneMessageClient } from '@benzenejs/kafka-core';

const producer = new Kafka({ brokers: ['localhost:9092'] }).producer();
await producer.connect();

const client = new KafkaBenzeneMessageClient(producer);

// Topic, then payload, then optional headers. Headers are forwarded onto the Kafka record's headers —
// the same mechanism correlation-id / trace-context decorators rely on to reach the wire.
const result = await sendMessageAsync(client, 'hello_world', { name: 'World' }, { 'correlation-id': 'abc-1' });
```

The client JSON-serializes the payload as the Kafka message value. A persisted produce maps to an
`Accepted` result; a produce the broker doesn't persist maps to `UnexpectedError`, and a throwing
producer to `ServiceUnavailable`. A plain `producer.send(...)` call works too if you don't need the
Benzene client surface. The producer's lifetime is yours — the client never disconnects it.

## 8. Testing

`@benzenejs/kafka-core-test-helpers` boots your wiring in-memory and pushes native records through the
real consumer pipeline — no broker, no credentials. Because the harness boots a `BenzeneStartUp`, put
the same `useKafka` wiring in a startup class (selecting the worker with `useWorker`), then drive it
with `benzeneTestHost(...).buildKafkaWorkerHost()`:

```bash
npm install --save-dev vitest @benzenejs/testing @benzenejs/kafka-core-test-helpers
```

```ts
// test/worker.test.ts
import { describe, expect, it } from 'vitest';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useWorker } from '@benzenejs/self-host';
import { IKafkaConsumerFactory, useKafka } from '@benzenejs/kafka-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asKafkaBenzeneMessage } from '@benzenejs/kafka-core-test-helpers';
import { HelloWorldMessageHandler } from '../src/handlers.js';

// The test host never opens a broker connection, so its consumer factory is never invoked.
const noopConsumerFactory: IKafkaConsumerFactory = {
  create: () => {
    throw new Error('the Kafka consumer should not be created by the test host');
  },
};

class WorkerStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useWorker(app, (workers) =>
      useKafka(workers, { topics: ['hello_world'] }, noopConsumerFactory, (kafka) =>
        useMessageHandlers(kafka, HelloWorldMessageHandler),
      ),
    );
  }
}

describe('orders-worker', () => {
  it('routes a native record to the handler', async () => {
    const host = benzeneTestHost(WorkerStartUp).buildKafkaWorkerHost();

    const result = await host.handleAsync(
      asKafkaBenzeneMessage(messageBuilder('hello_world', { name: 'World' })),
    );

    expect(result?.isSuccessful).toBe(true);
  });
});
```

`asKafkaBenzeneMessage(messageBuilder(topic, payload))` builds the exact kafkajs record shape the broker
delivers — the topic is the literal Kafka topic, every header rides as a record header, and the
serialized payload is the raw value. `host.handleAsync(...)` runs it through the real pipeline the worker
would, returning the handler's recorded result. Use `withServices(...)` on the builder to swap in fakes
(for example an outbound message sender). See [Testing Benzene](testing-benzene.md) for the full pattern.

## Troubleshooting

**Handler never fires.** The `@message('...')` value must equal the **literal Kafka topic name**, not a
colon-separated id. Confirm `topics` in `BenzeneKafkaConfig` includes that topic and that the broker has
it.

**Records aren't redelivered after a failure.** Under the default auto-commit, a failed record is
skipped and the offset advances. For at-least-once redelivery set `commitOnlyOnSuccess: true` **and**
`catchHandlerExceptions: false` (with `preserveOrderPerPartition: true`) — the worker enforces this
combination at `startAsync` and throws otherwise.

**Health check does nothing.** The reachability check is a no-op unless you pass a
`KafkaAdminClientFactory` as the fifth argument to `useKafka` — the config alone carries no broker
settings, so there's no way to build an admin client without it.

**Worker exits immediately.** `startAsync` returns once the consumer is *running* — it does not block.
Keep the process alive (the SIGINT/SIGTERM handlers above), or await your own shutdown signal.

## See Also

- [`examples/kafka`](../examples/kafka) — a runnable Kafka consumer worker + producer
- [Getting Started](getting-started.md) — build the same handler locally first
- [AWS Lambda Setup](getting-started-aws.md) — the same handlers, triggered by MSK / self-managed Kafka
- [Azure Functions Setup](getting-started-azure.md) — the same handlers, on the Azure Kafka trigger
- [Message Handlers](message-handlers.md) — the handler contract, topics, and `@message`
- [Middleware](middleware.md) and [Common Middleware](common-middleware.md) — what else composes into the pipeline
- [Correlation IDs](correlation-ids.md) — trace records across services via headers
- [Testing Benzene](testing-benzene.md) — testing handlers and pipelines end-to-end
