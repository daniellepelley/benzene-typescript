import { IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { BenzeneMessageApplication } from '@benzenejs/core-message-handlers';
import { AwsEventStreamContext } from '../AwsEventStream/AwsEventStreamContext';
import { AwsLambdaMiddlewareRouter } from '../AwsLambdaMiddlewareRouter';
import { isBenzeneMessageEvent } from '../AwsEventPredicates';

/**
 * Port of Benzene.Aws.Lambda.Core.BenzeneMessage.BenzeneMessageLambdaHandler.
 *
 * Routes AWS Lambda invocations whose payload is a `BenzeneMessageRequest` (a transport-neutral
 * `{ topic, headers, body }` envelope) to the shared BenzeneMessage pipeline — the **direct-invoke**
 * surface. This is the Lambda-to-Lambda path the mesh aggregator uses to interrogate a service: a
 * synchronous `Invoke` carrying the reserved `benzene:spec`/`benzene:healthcheck` topic reaches the service's message
 * handlers with no HTTP surface required.
 *
 * Added to the outer `AwsEventStreamContext` pipeline by `useBenzeneMessage`. It handles the invocation
 * only if the payload has a non-empty `topic` (via the shared `isBenzeneMessageEvent` predicate);
 * otherwise it defers to the next middleware, so an API Gateway / SQS / … adapter can claim the same raw
 * payload instead.
 *
 * (The C# original swaps in a source-generated JSON serializer for a cold-start win; that's a .NET AOT
 * concern with no Node equivalent — the event arrives already parsed — so it is not ported.)
 */
export class BenzeneMessageLambdaHandler extends AwsLambdaMiddlewareRouter<BenzeneMessageRequest> {
  private readonly directMessageApplication: BenzeneMessageApplication;

  constructor(pipeline: IMiddlewarePipeline<BenzeneMessageContext>, serviceResolver: IServiceResolver) {
    super(serviceResolver);
    this.directMessageApplication = new BenzeneMessageApplication(pipeline);
  }

  /** True if the invocation payload looks like a BenzeneMessage request (it has a topic). */
  protected canHandle(request: BenzeneMessageRequest): boolean {
    return isBenzeneMessageEvent(request);
  }

  /** Runs the BenzeneMessage application and writes the `{ statusCode, headers, body }` response onto the outer context. */
  protected async handleFunction(
    request: BenzeneMessageRequest,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.directMessageApplication.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
