/** Port of Benzene.Aws.Lambda.Kafka.KafkaOptions. */
import { KafkaBatchFailureMode } from './KafkaBatchFailureMode';

/**
 * Configures how `KafkaApplication` handles per-record failures within a Kafka batch.
 */
export class KafkaOptions {
  /**
   * How a single record's failure affects the rest of the batch. Defaults to
   * `KafkaBatchFailureMode.PartialBatchFailure` (safe-by-default: a failed partition is reported for
   * redelivery from its resume offset rather than the whole batch being silently settled).
   */
  batchFailureMode: KafkaBatchFailureMode = KafkaBatchFailureMode.PartialBatchFailure;
}
