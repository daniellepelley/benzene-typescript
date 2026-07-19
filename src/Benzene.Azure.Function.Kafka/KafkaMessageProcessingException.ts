/** Port of Benzene.Azure.Function.Kafka.KafkaMessageProcessingException. */

/**
 * Thrown by `KafkaBatchApplication` when `KafkaOptions.raiseOnFailureStatus` is enabled and a message
 * handler reported an unsuccessful result without itself throwing — escalating the failure into an
 * exception so it's treated the same as an unhandled exception for retry purposes. C# `Exception` maps
 * to `Error`.
 */
export class KafkaMessageProcessingException extends Error {
  /** The Kafka topic the failing record was on. */
  readonly topic: string;

  constructor(topic: string) {
    super(`Message handler reported an unsuccessful result for a Kafka record on topic ${topic}.`);
    this.name = 'KafkaMessageProcessingException';
    this.topic = topic;
  }
}
