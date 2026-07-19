/** Port of Benzene.Aws.Lambda.Kafka.KafkaContext. */
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';
import { MSKEvent, MSKRecord } from 'aws-lambda';

/**
 * The middleware pipeline context for a single record within a Kafka event.
 *
 * TYPE-MODEL mapping: the .NET types (`Amazon.Lambda.KafkaEvents`) expose the event as `KafkaEvent` and
 * each record as the nested `KafkaEvent.KafkaEventRecord`. The `@types/aws-lambda` equivalents are `MSKEvent`
 * (Amazon MSK / managed Kafka) and the top-level `MSKRecord`. Note the event's `records` is an OBJECT keyed
 * by `"topic-partition"` → `MSKRecord[]` (not a flat array); `KafkaApplication` flattens it. `MSKRecord`
 * fields are camelCase: `record.topic`, `record.partition`, `record.key`, `record.value` (base64),
 * `record.headers`.
 */
export class KafkaContext implements IHasMessageResult {
  constructor(kafkaEvent: MSKEvent, kafkaEventRecord: MSKRecord) {
    this.kafkaEvent = kafkaEvent;
    this.kafkaEventRecord = kafkaEventRecord;
  }

  /** The full Kafka event this record belongs to (spanning one or more topic partitions). */
  readonly kafkaEvent: MSKEvent;

  /** The specific Kafka record this context represents. */
  readonly kafkaEventRecord: MSKRecord;

  /** The result of handling this record. Set by `KafkaMessageMessageHandlerResultSetter`. */
  messageResult!: IMessageResult;
}
