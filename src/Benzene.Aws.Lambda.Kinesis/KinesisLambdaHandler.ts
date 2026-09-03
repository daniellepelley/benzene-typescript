/** Port of Benzene.Aws.Lambda.Kinesis.KinesisLambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewareApplicationWithResult } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter, isKinesisEvent } from '@benzenejs/aws-lambda-core';
import { KinesisStreamBatchResponse, KinesisStreamEvent } from 'aws-lambda';

/**
 * Routes AWS Lambda invocations whose event is a `KinesisStreamEvent` to the Kinesis pipeline. Added to
 * the outer `AwsEventStreamContext` pipeline by `useKinesis`; it only handles the invocation when the
 * first record's source is `aws:kinesis`, otherwise it defers to the next middleware.
 *
 * Writes back the `KinesisStreamBatchResponse` the application computes — for a trigger with
 * `ReportBatchItemFailures` configured, the invocation is synchronous from Lambda's own perspective
 * and AWS reads the single reported resume point to redeliver the unfinished tail of the batch (see
 * `KinesisApplication`). Without `ReportBatchItemFailures` the response body is ignored by AWS, so
 * the batch settles whole-batch-on-success exactly as before.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: `tryExtractRequest` (inherited from `AwsLambdaMiddlewareRouter`)
 * returns the already-parsed `context.event` as `KinesisStreamEvent`; `canHandle` does the real
 * discrimination on `eventSource`. PascalCase mapping: `event.Records` (stays PascalCase in
 * `@types/aws-lambda`), `records[0].eventSource` (record envelope is camelCase).
 *
 * C# `StreamMiddlewareApplication<..., KinesisBatchResponse>` maps to
 * `IMiddlewareApplicationWithResult<KinesisStreamEvent, KinesisStreamBatchResponse>` (the
 * `WithResult` rule) — the same shape as `DynamoDbLambdaHandler`.
 */
export class KinesisLambdaHandler extends AwsLambdaMiddlewareRouter<KinesisStreamEvent> {
  constructor(
    private readonly application: IMiddlewareApplicationWithResult<
      KinesisStreamEvent,
      KinesisStreamBatchResponse
    >,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event has at least one record sourced from Kinesis. */
  protected canHandle(request: KinesisStreamEvent): boolean {
    return isKinesisEvent(request);
  }

  /** Runs the Kinesis application and writes the batch response onto the outer context. */
  protected async handleFunction(
    request: KinesisStreamEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
