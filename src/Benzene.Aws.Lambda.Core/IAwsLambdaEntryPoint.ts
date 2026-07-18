import { Context } from 'aws-lambda';

/**
 * Port of Benzene.Aws.Lambda.Core.IAwsLambdaEntryPoint.
 *
 * The entry point AWS Lambda invokes for each function invocation. Implemented by
 * `AwsLambdaEntryPoint`.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: the .NET signature is
 * `Task<Stream> FunctionHandlerAsync(Stream, ILambdaContext)`, taking and returning raw payload
 * streams. A Node Lambda handler is `(event, context) => result` over an already-parsed event, so
 * the port takes `event: unknown` and returns `Promise<unknown>` (the value to serialize back). See
 * `AwsEventStreamContext` for the full rationale. C# `IDisposable` maps to `dispose()`.
 */
export interface IAwsLambdaEntryPoint {
  /**
   * Handles a single AWS Lambda invocation.
   * @param event The already-parsed Lambda invocation event.
   * @param context The AWS Lambda execution context for this invocation.
   * @returns The value to return from the invocation.
   */
  functionHandlerAsync(event: unknown, context: Context): Promise<unknown>;

  /** Port of C# `IDisposable.Dispose()`. */
  dispose(): void;
}
