# `@benzene-example/kafka`

A standalone **Kafka consumer worker** over [`@benzene/kafka-core`](../../src/Benzene.Kafka.Core) (on
`kafkajs`) hosting an order domain, plus the **producer client** that feeds it. Ported from the .NET
`Benzene.Examples.Kafka` (consumer worker + producer).

## Consumer

[`src/startUp.ts`](src/startUp.ts) mounts a long-running worker with `useKafka(...)` that subscribes to the
order topics and routes each record to its handler ([`src/handlers.ts`](src/handlers.ts)) — Kafka routes on
the literal record topic, so the `@message` topics **are** the Kafka topic names:

| Topic | Handler | Effect |
|---|---|---|
| `order_create` | `CreateOrderHandler` | persists an order to the store |
| `order_delete` | `DeleteOrderHandler` | removes an order (fire-and-forget) |

The caller builds the kafkajs `Consumer` (brokers, group id, auth) and hands it to the worker via an
`IKafkaConsumerFactory` — the worker only subscribes, runs, and disconnects it. `kafkaConsumerFactory(...)`
builds one lazily for a deployed worker.

## Producer

[`src/producer.ts`](src/producer.ts) wraps a kafkajs `Producer` as a Benzene `IBenzeneMessageClient`
(`KafkaBenzeneMessageClient`): `sendMessageAsync(client, 'order_create', msg)` produces to the
`order_create` topic with the JSON-serialized body — the same message the consumer above handles.

## Verify it

`test/Benzene.Core.Test/Examples/KafkaExampleTest.test.ts` runs entirely **in-memory, no broker**. The
consumer half boots the real `KafkaOrdersStartUp` with `benzeneTestHost(StartUp).buildKafkaWorkerHost()`
and pushes native records through the front door with `asKafkaBenzeneMessage(messageBuilder(...))`,
asserting each routes to its handler and mutates the store. The producer half drives the client over a fake
kafkajs `Producer`, asserting the produced record's topic and body. (The .NET example's tests instead run
against a real broker via docker-compose; the TypeScript port's in-process worker-host seam makes a broker
unnecessary.)
