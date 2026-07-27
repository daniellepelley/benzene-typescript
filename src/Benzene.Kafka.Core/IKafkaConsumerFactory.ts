/** Port of Benzene.Kafka.Core.IKafkaConsumerFactory / KafkaConsumerFactory. */
import { Consumer } from 'kafkajs';

/**
 * Creates the underlying kafkajs {@link Consumer} {@link BenzeneKafkaWorker} uses to consume records.
 * Lets the caller decide the brokers, group id, authentication (SASL/SSL, OAUTHBEARER, …), and any other
 * `Kafka`/`consumer` construction detail without the worker prescribing any of it — the worker only
 * subscribes, runs, commits, and disconnects the supplied consumer.
 *
 * PORTING NOTE: .NET's `IKafkaConsumerFactory<TKey, TValue>` builds a Confluent `IConsumer<TKey, TValue>`
 * from a `ConsumerConfig` (plus an optional `ConsumerBuilder` configuration step for deserializers /
 * OAuth). kafkajs has no builder or typed deserializers — the caller constructs the `Consumer` up front
 * (`new Kafka({ brokers, ... }).consumer({ groupId, ... })`), so the seam is a zero-arg `create()`
 * returning that ready consumer, and there are no `TKey`/`TValue` type parameters (kafkajs delivers raw
 * `Buffer` key/value). Like the SQS/Service Bus/Event Hubs factories, it is passed directly to `useKafka`
 * (not resolved from the container), so it declares no `ServiceToken`.
 */
export interface IKafkaConsumerFactory {
  /** Creates (returns) the consumer. The caller owns its construction; the worker owns its lifecycle. */
  create(): Consumer;
}

/**
 * A {@link IKafkaConsumerFactory} that returns the injected kafkajs {@link Consumer} instance. The
 * caller builds the consumer (brokers, group id, authentication); the worker subscribes, runs, and
 * disconnects it. Mirrors `EventProcessorClientFactory`.
 */
export class KafkaConsumerFactory implements IKafkaConsumerFactory {
  constructor(private readonly consumer: Consumer) {}

  create(): Consumer {
    return this.consumer;
  }
}
