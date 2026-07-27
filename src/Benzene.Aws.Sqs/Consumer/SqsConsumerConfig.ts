/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerConfig. */
import { SqsConsumerMessageTopicGetter } from './SqsConsumerMessageTopicGetter';

/** Configures the queue, batch size, and long-poll wait used by {@link SqsConsumer}. */
export interface SqsConsumerConfig {
  /** The URL of the SQS queue to poll. */
  queueUrl: string;
  /** The maximum number of messages to receive per poll (1–10, per the SQS API). */
  maxNumberOfMessages: number;
  /** The SQS long-poll wait time in seconds (0–20). Defaults to 20 (maximum long polling). */
  waitTimeSeconds?: number;
  /** The message attribute the topic is read from. Defaults to `"topic"`. */
  topicAttributeKey?: string;
}

/** Fills in the defaults (`waitTimeSeconds = 20`, `topicAttributeKey = "topic"`). */
export function withConfigDefaults(config: SqsConsumerConfig): Required<SqsConsumerConfig> {
  return {
    queueUrl: config.queueUrl,
    maxNumberOfMessages: config.maxNumberOfMessages,
    waitTimeSeconds: config.waitTimeSeconds ?? 20,
    topicAttributeKey: config.topicAttributeKey ?? SqsConsumerMessageTopicGetter.DefaultTopicAttribute,
  };
}
