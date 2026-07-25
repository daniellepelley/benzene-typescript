/**
 * SQS function. Point an SQS event-source mapping at this module's `handler`. Each record's `topic`
 * message attribute routes it to the matching handler; partial-batch failures are reported back to SQS.
 */
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useSqs } from '@benzene/aws-lambda-sqs';
import { lambdaHandler } from '../lambda';
import { NotifyWarehouseHandler } from '../handlers';

export const handler = lambdaHandler((app) =>
  useSqs(app, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler)),
);
