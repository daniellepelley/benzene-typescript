import { Context } from 'aws-lambda';

/**
 * Port of Benzene.Aws.Lambda.Core.AwsEventStream.AwsEventStreamContext.
 *
 * The unified context for an AWS Lambda invocation, before the event has been identified as a
 * specific event source type (API Gateway, SQS, SNS, ...). It is the context type of the outermost
 * `MiddlewarePipelineBuilder<AwsEventStreamContext>`; event-source-specific routers
 * (`AwsLambdaMiddlewareRouter<TRequest>`) inspect the event, decide whether it is theirs, and if so
 * write the response to `response`.
 *
 * STREAM -> PARSED-EVENT ADAPTATION (documented per the port's platform-adaptation rule).
 * The .NET original holds a raw `System.IO.Stream` payload and a `Stream` response, because a .NET
 * Lambda entry point receives the invocation as an unparsed byte stream and uses
 * `DefaultLambdaJsonSerializer` to sniff/deserialize it. A Node AWS Lambda handler is different: the
 * runtime hands the handler an ALREADY-PARSED event object (`(event, context) => result`). So this
 * port drops the streams entirely:
 *   - C# `Stream Stream`        -> `event: unknown`   (the already-parsed Lambda event object)
 *   - C# `ILambdaContext`       -> `lambdaContext: Context` (from `@types/aws-lambda`)
 *   - C# `Stream Response`      -> `response: unknown | undefined` (the value to return; not a stream)
 * Because Node has no serialize/deserialize step at the boundary, `response` starts `undefined`
 * (rather than an empty `MemoryStream`) and stays `undefined` until a router handles the event —
 * which is exactly the signal `AwsLambdaEntryPoint` uses to raise its "event not recognized" error.
 */
export class AwsEventStreamContext {
  /**
   * @param event The already-parsed Lambda invocation event (Node passes a parsed object, not a stream).
   * @param lambdaContext The AWS Lambda execution context for this invocation.
   */
  constructor(event: unknown, lambdaContext: Context) {
    this.event = event;
    this.lambdaContext = lambdaContext;
  }

  /** The already-parsed Lambda invocation event. */
  readonly event: unknown;

  /** The AWS Lambda execution context for this invocation. */
  readonly lambdaContext: Context;

  /**
   * The value to be returned from the Lambda invocation. Unlike the .NET original (which initializes
   * this to an empty `MemoryStream`), it starts `undefined`: a router that handles the event assigns
   * its response here, and if none does, `AwsLambdaEntryPoint` raises an error.
   */
  response: unknown | undefined = undefined;
}
