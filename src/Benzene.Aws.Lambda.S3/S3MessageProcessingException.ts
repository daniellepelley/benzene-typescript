/** Port of Benzene.Aws.Lambda.S3.S3MessageProcessingException. */

/**
 * Thrown by `S3Application` when `S3Options.raiseOnFailureStatus` is enabled and a message handler
 * reported an unsuccessful result without itself throwing — escalating the failure into an exception so
 * S3's async-invoke retry applies the same way it would for an unhandled exception. C# `Exception` maps
 * to `Error`.
 */
export class S3MessageProcessingException extends Error {
  /** The S3 object key the handler reported a failure for. */
  readonly objectKey: string | undefined;

  constructor(objectKey: string | undefined) {
    super(`Message handler reported an unsuccessful result for S3 object ${objectKey}.`);
    this.name = 'S3MessageProcessingException';
    this.objectKey = objectKey;
  }
}
