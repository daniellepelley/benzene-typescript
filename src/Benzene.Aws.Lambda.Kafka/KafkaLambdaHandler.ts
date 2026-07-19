/** Port of Benzene.Aws.Lambda.Kafka.KafkaLambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewareApplication } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter } from '@benzene/aws-lambda-core';
import { MSKEvent } from 'aws-lambda';

/**
 * Routes AWS Lambda invocations whose event is a Kafka (`MSKEvent`) event to the Kafka middleware pipeline.
 * Added to the outer `AwsEventStreamContext` pipeline by `useKafka`; it only handles the invocation if the
 * event source is `aws:kafka`, otherwise it defers to the next middleware. Kafka events don't return a
 * response — this is a fire-and-forget pattern.
 *
 * DISCRIMINATOR: unlike the record-batch sources that inspect `Records[0].eventSource`, the Kafka envelope
 * carries a top-level `eventSource: "aws:kafka"` (its records live under a keyed `records` object), so
 * `canHandle` checks that top-level field directly — matching C# `request?.EventSource == "aws:kafka"`.
 *
 * FIRE-AND-FORGET / RESPONSE SENTINEL: like `SnsLambdaHandler`/`S3LambdaHandler`, this port writes the
 * `null` "handled, no body" sentinel via `mapResponse` (this port's `AwsEventStreamContext.response` starts
 * `undefined`, which the entry point reads as "event not recognized"), whereas the C# original relies on a
 * pre-initialized response stream.
 */
export class KafkaLambdaHandler extends AwsLambdaMiddlewareRouter<MSKEvent> {
  constructor(
    private readonly application: IMiddlewareApplication<MSKEvent>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event's source is `aws:kafka`. */
  protected canHandle(request: MSKEvent): boolean {
    return request?.eventSource === 'aws:kafka';
  }

  /** Runs the Kafka application (no response) and marks the event as handled via the null sentinel. */
  protected async handleFunction(
    request: MSKEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, null);
  }
}
