/**
 * The producer half — port of the .NET `Benzene.Examples.Kafka.Producer`. A `KafkaBenzeneMessageClient`
 * sends a Benzene message by topic over a caller-supplied kafkajs `Producer`; the topic becomes the Kafka
 * record topic and the body is JSON-serialized. Send with `sendMessageAsync(client, 'order_create', msg)`.
 */
import { Producer } from 'kafkajs';
import { IBenzeneMessageClient } from '@benzene/clients';
import { KafkaBenzeneMessageClient } from '@benzene/kafka-core';

/** Wraps a kafkajs `Producer` as a Benzene message client for producing order events. */
export function createOrderProducer(producer: Producer): IBenzeneMessageClient {
  return new KafkaBenzeneMessageClient(producer);
}
