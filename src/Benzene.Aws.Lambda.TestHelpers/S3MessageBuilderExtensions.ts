/** S3 test-event builder (no C# TestHelper counterpart; based on the ported S3PipelineTest shape). */
import { S3Event, S3EventRecord } from 'aws-lambda';

export interface AsS3Options {
  /** The S3 event name, which is the routing topic (e.g. `"ObjectCreated:Put"`). Default `"ObjectCreated:Put"`. */
  eventName?: string;
  /** How many identical records to emit, default 1. */
  numberOfRecords?: number;
}

/**
 * Builds an `S3Event` for an object. Unlike the queue/stream builders, an S3 notification has no JSON
 * payload: the "message" IS the object reference (bucket + key), and routing is by the S3 event name (the
 * topic). So this builder takes `bucket`/`key`/`eventName` directly rather than a `messageBuilder`.
 */
export function asS3(bucket: string, key: string, options: AsS3Options = {}): S3Event {
  const { eventName = 'ObjectCreated:Put', numberOfRecords = 1 } = options;

  const records: S3EventRecord[] = Array.from({ length: numberOfRecords }, () => ({
    eventVersion: '2.1',
    eventSource: 'aws:s3',
    awsRegion: 'eu-west-1',
    eventTime: '2026-01-01T00:00:00.000Z',
    eventName,
    userIdentity: { principalId: 'benzene-test' },
    requestParameters: { sourceIPAddress: '127.0.0.1' },
    responseElements: { 'x-amz-request-id': 'req-1', 'x-amz-id-2': 'id-2' },
    s3: {
      s3SchemaVersion: '1.0',
      configurationId: 'benzene-test',
      bucket: { name: bucket, ownerIdentity: { principalId: 'benzene-test' }, arn: `arn:aws:s3:::${bucket}` },
      object: { key, size: 1, eTag: 'etag', sequencer: '0' },
    },
  }));

  return { Records: records };
}
