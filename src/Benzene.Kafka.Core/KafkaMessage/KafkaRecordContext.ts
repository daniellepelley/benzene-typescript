/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaRecordContext. */
import { EachMessagePayload } from 'kafkajs';
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';

/**
 * Provides the middleware pipeline context for a single record consumed by the self-hosted Kafka
 * worker ({@link BenzeneKafkaWorker}).
 *
 * MESSAGE-TYPE ADAPTATION: .NET wraps a Confluent.Kafka `ConsumeResult<TKey, TValue>`; kafkajs delivers
 * each record to `eachMessage` as an `EachMessagePayload` (`{ topic, partition, message }`, where
 * `message` is a `KafkaMessage` carrying `key`/`value` as `Buffer | null`, `offset` as a string, and
 * `headers`). The port wraps that payload directly. Field mapping used by the getters/invocation:
 * `ConsumeResult.Topic`→`record.topic`, `ConsumeResult.Partition`→`record.partition`,
 * `ConsumeResult.Offset`→`record.message.offset`, `Message.Value`→`record.message.value`,
 * `Message.Headers`→`record.message.headers`.
 *
 * GENERIC ERASURE: the .NET type is `KafkaRecordContext<TKey, TValue>`. kafkajs has no per-message
 * generic deserializer seam (Confluent builds the consumer with typed serializers; kafkajs always
 * delivers raw `Buffer` key/value), so the port carries no `TKey`/`TValue` type parameters — the value
 * is handled as a `Buffer`/string by the body getter. See the README porting-conventions bullet.
 *
 * Implements `IHasMessageResult` so the worker can read the recorded result (the port mirrors
 * `EventHubConsumerContext`); `undefined` (C# `null`) until a result is recorded.
 */
export class KafkaRecordContext implements IHasMessageResult {
  private constructor(readonly record: EachMessagePayload) {}

  /** Creates a new context for a consumed record. Port of the C# constructor. */
  static createInstance(record: EachMessagePayload): KafkaRecordContext {
    return new KafkaRecordContext(record);
  }

  /**
   * The result of handling this record. Set by {@link KafkaMessageHandlerResultSetter}. Drives the
   * worker's `commitOnlyOnSuccess` gating and middleware/diagnostics; `undefined` (C# `null`) until a
   * result is recorded.
   */
  messageResult!: IMessageResult;
}
