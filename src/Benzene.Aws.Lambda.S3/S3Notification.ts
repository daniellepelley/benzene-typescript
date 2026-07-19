/** Port of Benzene.Aws.Lambda.S3.S3Notification. */

/**
 * The message payload an S3 event notification is deserialized into for message handlers. A handler can
 * declare this (or any type with matching properties) as its request type to receive the bucket, object
 * key, and related metadata of the S3 event.
 *
 * C# PascalCase properties become camelCase members (the port convention); the body getter serializes an
 * instance with the same TypeScript `JsonSerializer` a handler's request mapper deserializes with, so the
 * two stay wire-compatible.
 */
export class S3Notification {
  /**
   * The S3 event name, e.g. `ObjectCreated:Put` or `ObjectRemoved:Delete`. This is also the topic the
   * record is routed by.
   */
  eventName: string | undefined;

  /** The AWS region the event originated in. */
  awsRegion: string | undefined;

  /** The name of the bucket the object belongs to. */
  bucketName: string | undefined;

  /** The object key. */
  key: string | undefined;

  /** The object size in bytes. */
  size = 0;

  /** The object ETag. */
  eTag: string | undefined;
}
