/** Port of Benzene.Kafka.Core.KafkaMessageProcessingException. */

/**
 * Thrown inside `BenzeneKafkaWorker` when `BenzeneKafkaConfig.raiseOnFailureStatus` is on (the default) and
 * a record's handler reported a failure result, so it takes the same path as a thrown exception: skipped
 * and logged under `catchHandlerExceptions` (the default), or — under `commitOnlyOnSuccess` — left
 * uncommitted while the worker stops, so a restart redelivers it.
 */
export class KafkaMessageProcessingException extends Error {
  constructor(
    readonly topic: string,
    readonly partition: number,
    readonly offset: string,
    readonly status: string | undefined,
  ) {
    super(
      `Kafka record ${topic}-${partition}-${offset} was not processed successfully (status '${status ?? '<none>'}').`,
    );
    this.name = 'KafkaMessageProcessingException';
  }
}
