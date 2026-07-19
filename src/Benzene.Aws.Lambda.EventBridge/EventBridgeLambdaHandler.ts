/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeLambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewareApplication } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter } from '@benzene/aws-lambda-core';
import { EventBridgeEvent } from 'aws-lambda';

/**
 * Routes AWS Lambda invocations whose event is an EventBridge event to the EventBridge pipeline. Added to
 * the outer `AwsEventStreamContext` pipeline by `useEventBridge`.
 *
 * DISCRIMINATOR: an EventBridge payload is identified by the presence of BOTH `detail-type` and `source` —
 * no other Lambda event source carries those fields (SQS/SNS/S3 payloads have `Records`; API Gateway and
 * BenzeneMessage payloads have neither). This is the structural difference from the record-batch sources:
 * a single event object, not a `Records` array. Non-matching payloads defer to the next middleware. The
 * invocation is fire-and-forget (EventBridge targets are invoked asynchronously), so no response is written.
 *
 * FIRE-AND-FORGET / RESPONSE SENTINEL: like `SnsLambdaHandler`/`S3LambdaHandler`, this port writes the
 * `null` "handled, no body" sentinel via `mapResponse` (this port's `AwsEventStreamContext.response` starts
 * `undefined`, which the entry point reads as "event not recognized"), whereas the C# original relies on a
 * pre-initialized response stream.
 */
export class EventBridgeLambdaHandler extends AwsLambdaMiddlewareRouter<EventBridgeEvent<string, unknown>> {
  constructor(
    private readonly application: IMiddlewareApplication<EventBridgeEvent<string, unknown>>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event carries both `detail-type` and `source` (the EventBridge envelope discriminator). */
  protected canHandle(request: EventBridgeEvent<string, unknown>): boolean {
    return request?.['detail-type'] != null && request.source != null;
  }

  /** Runs the EventBridge application (no response) and marks the event as handled via the null sentinel. */
  protected async handleFunction(
    request: EventBridgeEvent<string, unknown>,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, null);
  }
}
