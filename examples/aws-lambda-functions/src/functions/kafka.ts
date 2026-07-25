/**
 * Kafka (Amazon MSK) function. Point an MSK / self-managed-Kafka event-source mapping at this module's
 * `handler`. The record's Kafka topic routes it; the base64 record value is the payload.
 */
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useKafka } from '@benzene/aws-lambda-kafka';
import { lambdaHandler } from '../lambda';
import { NotifyWarehouseHandler } from '../handlers';

export const handler = lambdaHandler((app) =>
  useKafka(app, (kafka) => useMessageHandlers(kafka, NotifyWarehouseHandler)),
);
