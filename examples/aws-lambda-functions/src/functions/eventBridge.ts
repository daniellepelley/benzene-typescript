/**
 * EventBridge function. Point an EventBridge rule at this module's `handler`. The event's `detail-type`
 * is the topic and `detail` is the payload; delivery is fire-and-forget.
 */
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useEventBridge } from '@benzene/aws-lambda-eventbridge';
import { lambdaHandler } from '../lambda';
import { NotifyWarehouseHandler } from '../handlers';

export const handler = lambdaHandler((app) =>
  useEventBridge(app, (eb) => useMessageHandlers(eb, NotifyWarehouseHandler)),
);
