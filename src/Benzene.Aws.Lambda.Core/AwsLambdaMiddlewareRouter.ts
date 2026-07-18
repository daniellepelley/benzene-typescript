import { IServiceResolver } from '@benzene/abstractions';
import { MiddlewareRouter } from '@benzene/core-middleware';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';

/**
 * Port of Benzene.Aws.Lambda.Core.AwsLambdaMiddlewareRouter&lt;TRequest&gt;.
 *
 * Base class for the AWS event-source adapters (SQS, SNS, API Gateway, EventBridge, ...). Each one
 * extends the already-ported `MiddlewareRouter<TRequest, AwsEventStreamContext>`, deciding via
 * `canHandle` whether the invocation's event is its event type and, if so, handling it and writing
 * the response.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: the .NET original carries a `DefaultLambdaJsonSerializer` and,
 * in `TryExtractRequest`, rewinds and deserializes the raw payload stream into `TRequest` (returning
 * `default` on failure), then `MapResponse` serializes the response object back into the response
 * stream. In Node the event is ALREADY PARSED, so there is nothing to deserialize:
 *   - `tryExtractRequest(context)` simply returns `context.event as TRequest` — every concrete
 *     router's own `canHandle` does the real discrimination (e.g. the SQS router checks the records'
 *     `eventSource`), so a mis-typed cast never handles the wrong event.
 *   - `mapResponse(context, response)` just assigns `context.response = response` (no serialization);
 *     `AwsLambdaEntryPoint` returns that value and the Node runtime serializes it at the boundary.
 */
export abstract class AwsLambdaMiddlewareRouter<TRequest> extends MiddlewareRouter<
  TRequest,
  AwsEventStreamContext
> {
  protected constructor(serviceResolver: IServiceResolver) {
    super(serviceResolver);
  }

  /**
   * Returns the already-parsed event cast to `TRequest`. No stream deserialization is needed — the
   * event arrives parsed and the concrete router's `canHandle` performs the real discrimination.
   */
  protected tryExtractRequest(context: AwsEventStreamContext): TRequest | undefined {
    return context.event as TRequest;
  }

  /** Assigns the response object onto the context (no serialization; see class remarks). */
  protected mapResponse(context: AwsEventStreamContext, response: unknown): void {
    context.response = response;
  }
}
