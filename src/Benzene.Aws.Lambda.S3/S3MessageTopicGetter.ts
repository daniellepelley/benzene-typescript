/** Port of Benzene.Aws.Lambda.S3.S3MessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { S3RecordContext } from './S3RecordContext';

/**
 * Extracts the message topic from an S3 event notification record's event name (e.g. `ObjectCreated:Put`),
 * so records route to a message handler declaring that topic. S3's native event name IS the routing key —
 * no `topic` attribute needs bolting on the way SQS/SNS require. Field mapping: C# `EventName` becomes
 * `s3EventNotificationRecord.eventName`.
 */
export class S3MessageTopicGetter implements IMessageTopicGetter<S3RecordContext> {
  getTopic(context: S3RecordContext): ITopic | undefined {
    return new Topic(context.s3EventNotificationRecord.eventName);
  }
}
