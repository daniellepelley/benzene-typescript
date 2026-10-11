/** Port of Benzene.Aws.Lambda.S3.S3MessageProcessingException. */

/**
 * Thrown by `S3Application` when `S3Options.raiseOnFailureStatus` is enabled (the default) and a record
 * was not processed successfully — a failure result, or none — escalating it so Lambda's async-invoke
 * retry applies as it would for an unhandled exception.
 */
export class S3MessageProcessingException extends Error {
  /** The object key of the record that failed. */
  readonly objectKey: string | undefined;

  constructor(objectKey: string | undefined, eventName: string | undefined) {
    super(
      `S3 notification '${eventName ?? '<no event name>'}' for object ${objectKey ?? '<no key>'} was not processed ` +
        'successfully (a failure result, no result, or an event name no handler serves); failing the invocation ' +
        'so it is retried. Set ignoreUnmatchedTopics or atMostOnce to acknowledge instead.',
    );
    this.name = 'S3MessageProcessingException';
    this.objectKey = objectKey;
  }
}
