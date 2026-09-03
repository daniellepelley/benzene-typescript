/**
 * Port of Benzene.Aws.Lambda.Kafka.KafkaBatchResponse.
 *
 * The response an Amazon MSK / self-managed Kafka event source mapping reads back when
 * `ReportBatchItemFailures` is configured on the trigger's `FunctionResponseTypes`.
 *
 * Hand-modeled (like the .NET original hand-rolls it) because `@types/aws-lambda` ships no Kafka batch
 * response type. The Kafka wire contract differs from Kinesis/DynamoDB/SQS: the `itemIdentifier` is a
 * JSON OBJECT naming the topic-partition and the offset to resume from, not a bare string —
 * `{ "batchItemFailures": [ { "itemIdentifier": { "partition": "my-topic-0", "offset": 100 } } ] }`.
 * AWS resumes each reported topic-partition from the named offset; any `partition`/`offset` that
 * wasn't in the invoked event is treated as an error and retries the whole batch.
 */
export interface KafkaBatchResponse {
  /** The batch item failures reported back to the Kafka event source mapping. */
  batchItemFailures: KafkaBatchItemFailure[];
}

/** A single reported failure, identifying the topic-partition and offset to resume from. */
export interface KafkaBatchItemFailure {
  /** The topic-partition/offset resume point for this failure. */
  itemIdentifier: KafkaItemIdentifier;
}

/** The Kafka-shaped item identifier: a topic-partition plus the offset to resume from. */
export interface KafkaItemIdentifier {
  /** The `topic-partition_number` key (e.g. `"my-topic-0"`). */
  partition: string;

  /** The offset of the first record to resume from within the partition. */
  offset: number;
}
