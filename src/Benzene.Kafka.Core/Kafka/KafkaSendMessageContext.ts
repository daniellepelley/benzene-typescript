/** Port of Benzene.Kafka.Core.Kafka.KafkaSendMessageContext. */
import { Message, RecordMetadata } from 'kafkajs';

/**
 * The middleware pipeline context for producing a single message to Kafka: the target topic and the
 * message (key/value/headers), plus a settable slot for the produce result.
 *
 * SDK-MAPPING BEND: C# holds a Confluent `Message<string, string>` and a `DeliveryResult<string, string>
 * Response`. kafkajs has no `DeliveryResult`/`PersistenceStatus`; `producer.send(...)` resolves to a
 * `RecordMetadata[]` (one entry per produced message, each with an `errorCode`). So `message` is a
 * kafkajs `Message` and `response` is `RecordMetadata[]`. "Persisted" (C# `PersistenceStatus.Persisted`)
 * maps to a resolved send whose every `RecordMetadata.errorCode` is `0` — see {@link isKafkaMessagePersisted}.
 */
export class KafkaSendMessageContext {
  /** The produce result, set by `KafkaClientMiddleware`. Undefined until the produce completes. */
  response?: RecordMetadata[];

  constructor(
    readonly topic: string,
    readonly message: Message,
  ) {}
}

/**
 * Whether a produce result counts as persisted — the kafkajs equivalent of C#'s
 * `DeliveryResult.Status == PersistenceStatus.Persisted`: the send resolved with at least one record and
 * every record's `errorCode` is `0` (success). A rejected send never reaches here (it throws out of the
 * middleware), so an undefined/empty response is treated as not-persisted.
 */
export function isKafkaMessagePersisted(response: RecordMetadata[] | undefined): boolean {
  return response !== undefined && response.length > 0 && response.every((r) => r.errorCode === 0);
}
