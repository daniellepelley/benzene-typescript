/** Port of Benzene.Aws.Lambda.S3.S3MessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { S3RecordContext } from './S3RecordContext';

/**
 * Exposes an S3 record's event name, region, bucket, and key as message headers, omitting any that aren't
 * present on the record. Field mapping (camelCase in `@types/aws-lambda`): C# `record.EventName`/
 * `AwsRegion`/`S3.Bucket.Name`/`S3.Object.Key` become `record.eventName`/`awsRegion`/`s3.bucket.name`/
 * `s3.object.key`.
 */
export class S3MessageHeadersGetter implements IMessageHeadersGetter<S3RecordContext> {
  getHeaders(context: S3RecordContext): Record<string, string> {
    const record = context.s3EventNotificationRecord;
    const headers: Record<string, string> = {};

    if (record.eventName != null) {
      headers['eventName'] = record.eventName;
    }

    if (record.awsRegion != null) {
      headers['awsRegion'] = record.awsRegion;
    }

    if (record.s3?.bucket?.name != null) {
      headers['bucketName'] = record.s3.bucket.name;
    }

    if (record.s3?.object?.key != null) {
      headers['key'] = record.s3.object.key;
    }

    return headers;
  }
}
