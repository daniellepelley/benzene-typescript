/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { EventBridgeContext } from './EventBridgeContext';

/**
 * Resolves the message topic from the event's `detail-type` (C# plan decision E1) — EventBridge's native
 * routing key, so no `topic` attribute needs bolting on the way SQS/SNS require. Field mapping: C#
 * `context.Event.DetailType` becomes `context.event['detail-type']` (hyphenated key in `@types/aws-lambda`).
 */
export class EventBridgeMessageTopicGetter implements IMessageTopicGetter<EventBridgeContext> {
  getTopic(context: EventBridgeContext): ITopic | undefined {
    return new Topic(context.event['detail-type']);
  }
}
