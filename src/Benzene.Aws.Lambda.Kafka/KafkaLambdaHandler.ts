/** Port of Benzene.Aws.Lambda.Kafka.KafkaLambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewareApplicationWithResult } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter, isKafkaEvent } from '@benzenejs/aws-lambda-core';
import { MSKEvent } from 'aws-lambda';
import { KafkaBatchResponse } from './KafkaBatchResponse';

/**
 * Routes AWS Lambda invocations whose event is a Kafka (`MSKEvent`) event to the Kafka middleware pipeline.
 * Added to the outer `AwsEventStreamContext` pipeline by `useKafka`; it only handles the invocation if the
 * event source is `aws:kafka`, otherwise it defers to the next middleware.
 *
 * DISCRIMINATOR: unlike the record-batch sources that inspect `Records[0].eventSource`, the Kafka envelope
 * carries a top-level `eventSource: "aws:kafka"` (its records live under a keyed `records` object), so
 * `canHandle` checks that top-level field directly — matching C# `request?.EventSource == "aws:kafka"`.
 *
 * BATCH RESPONSE: like `SqsLambdaHandler`, this writes the application's `KafkaBatchResponse` onto the
 * outer context, so an event source mapping configured with `ReportBatchItemFailures` redrives only the
 * failed partitions from their reported resume offsets (C#
 * `IMiddlewareApplication<KafkaEvent, KafkaBatchResponse>` maps to
 * `IMiddlewareApplicationWithResult<MSKEvent, KafkaBatchResponse>` per the `WithResult` suffix rule).
 */
export class KafkaLambdaHandler extends AwsLambdaMiddlewareRouter<MSKEvent> {
  constructor(
    private readonly application: IMiddlewareApplicationWithResult<MSKEvent, KafkaBatchResponse>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event's source is `aws:kafka`. */
  protected canHandle(request: MSKEvent): boolean {
    return isKafkaEvent(request);
  }

  /** Runs the Kafka application and writes the batch response onto the outer context. */
  protected async handleFunction(
    request: MSKEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
