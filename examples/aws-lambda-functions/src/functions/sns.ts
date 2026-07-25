/**
 * SNS function. Subscribe this module's `handler` to an SNS topic. The notification's `topic` message
 * attribute routes it; SNS delivery is fire-and-forget.
 */
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useSns } from '@benzene/aws-lambda-sns';
import { lambdaHandler } from '../lambda';
import { NotifyWarehouseHandler } from '../handlers';

export const handler = lambdaHandler((app) =>
  useSns(app, (sns) => useMessageHandlers(sns, NotifyWarehouseHandler)),
);
