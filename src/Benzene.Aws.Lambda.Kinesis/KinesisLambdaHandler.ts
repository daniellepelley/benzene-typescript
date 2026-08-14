/** Port of Benzene.Aws.Lambda.Kinesis.KinesisLambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewareApplication } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter, isKinesisEvent } from '@benzenejs/aws-lambda-core';
import { KinesisStreamEvent } from 'aws-lambda';

/**
 * Routes AWS Lambda invocations whose event is a `KinesisStreamEvent` to the Kinesis pipeline. Added to
 * the outer `AwsEventStreamContext` pipeline by `useKinesis`; it only handles the invocation when the
 * first record's source is `aws:kinesis`, otherwise it defers to the next middleware. Kinesis targets are
 * invoked asynchronously — fire-and-forget, no response.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: `tryExtractRequest` (inherited from `AwsLambdaMiddlewareRouter`)
 * returns the already-parsed `context.event` as `KinesisStreamEvent`; `canHandle` does the real
 * discrimination on `eventSource`. PascalCase mapping: `event.Records` (stays PascalCase in
 * `@types/aws-lambda`), `records[0].eventSource` (record envelope is camelCase).
 *
 * FIRE-AND-FORGET / RESPONSE SENTINEL: as with SNS, this port's `AwsEventStreamContext.response` starts
 * `undefined` (the entry point's "event not recognized" signal), so a handling fire-and-forget router
 * writes the `null` "handled, no body" sentinel — see `SnsLambdaHandler` for the full explanation.
 */
export class KinesisLambdaHandler extends AwsLambdaMiddlewareRouter<KinesisStreamEvent> {
  constructor(
    private readonly application: IMiddlewareApplication<KinesisStreamEvent>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event has at least one record sourced from Kinesis. */
  protected canHandle(request: KinesisStreamEvent): boolean {
    return isKinesisEvent(request);
  }

  /** Runs the Kinesis application (no response) and marks the event as handled via the null sentinel. */
  protected async handleFunction(
    request: KinesisStreamEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, null);
  }
}
