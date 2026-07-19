/** Port of Benzene.Aws.Lambda.S3.S3MessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { S3Notification } from './S3Notification';
import { S3RecordContext } from './S3RecordContext';

/**
 * Builds the message body for an S3 record by serializing its bucket, object, and event metadata to JSON
 * (as an `S3Notification`), so it can be deserialized into a handler's request type.
 *
 * Field mapping (camelCase in `@types/aws-lambda`): C# `record.EventName`/`AwsRegion`/`S3.Bucket.Name`/
 * `S3.Object.Key`/`S3.Object.Size`/`S3.Object.ETag` become `record.eventName`/`awsRegion`/
 * `s3.bucket.name`/`s3.object.key`/`s3.object.size`/`s3.object.eTag`. Missing `size` maps to `0`
 * (C# `?? 0`). Uses a shared `JsonSerializer` instance, mirroring the C# `static readonly` serializer.
 */
export class S3MessageBodyGetter implements IMessageBodyGetter<S3RecordContext> {
  private static readonly serializer = new JsonSerializer();

  getBody(context: S3RecordContext): string | undefined {
    const record = context.s3EventNotificationRecord;

    const notification = new S3Notification();
    notification.eventName = record.eventName;
    notification.awsRegion = record.awsRegion;
    notification.bucketName = record.s3?.bucket?.name;
    notification.key = record.s3?.object?.key;
    notification.size = record.s3?.object?.size ?? 0;
    notification.eTag = record.s3?.object?.eTag;

    return S3MessageBodyGetter.serializer.serialize(notification);
  }
}
