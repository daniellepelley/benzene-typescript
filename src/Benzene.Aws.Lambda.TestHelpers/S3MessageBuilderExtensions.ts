/** S3 test-event builder (port of Benzene.Aws.Lambda.S3.TestHelpers' AsS3 key handling). */
import { S3Event, S3EventRecord } from 'aws-lambda';
import { S3ObjectKeyCodec } from '@benzenejs/aws-lambda-s3';

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
 *
 * `key` is the **plain** (decoded) object key; a real S3 event notification carries it URL-encoded
 * (space as `+`), so this helper stores `S3ObjectKeyCodec.encode(key)` on the record — the exact
 * inverse of the decode the real getters apply — so a key with a reserved character (e.g.
 * `"invoice+2024-08-27.pdf"`) reaches a handler unchanged instead of corrupted (.NET R12-13 #191).
 */
export function asS3(bucket: string, key: string, options: AsS3Options = {}): S3Event {
  const { eventName = 'ObjectCreated:Put', numberOfRecords = 1 } = options;
  const encodedKey = S3ObjectKeyCodec.encode(key)!;

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
      object: { key: encodedKey, size: 1, eTag: 'etag', sequencer: '0' },
    },
  }));

  return { Records: records };
}
