import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewareApplicationWithResult } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter } from '@benzene/aws-lambda-core';
import { SQSBatchResponse, SQSEvent } from 'aws-lambda';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsLambdaHandler.
 *
 * Routes AWS Lambda invocations whose event is an `SQSEvent` to the SQS middleware pipeline. Added to
 * the outer `AwsEventStreamContext` pipeline by `useSqs`; it only handles the invocation if the event
 * has records whose source is `aws:sqs`, otherwise it defers to the next middleware.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: `tryExtractRequest` (inherited from `AwsLambdaMiddlewareRouter`)
 * returns the already-parsed `context.event` as `SQSEvent`; `canHandle` does the real discrimination
 * on `eventSource`. PascalCase -> camelCase: `event.Records` (property stays PascalCase in
 * `@types/aws-lambda`), `records[0].eventSource`.
 *
 * C# `IMiddlewareApplication<SQSEvent, SQSBatchResponse>` maps to
 * `IMiddlewareApplicationWithResult<SQSEvent, SQSBatchResponse>` (the `WithResult` suffix rule).
 */
export class SqsLambdaHandler extends AwsLambdaMiddlewareRouter<SQSEvent> {
  constructor(
    private readonly application: IMiddlewareApplicationWithResult<SQSEvent, SQSBatchResponse>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event has at least one record sourced from SQS. */
  protected canHandle(request: SQSEvent): boolean {
    return (
      request?.Records !== undefined &&
      request.Records.length > 0 &&
      request.Records[0].eventSource === 'aws:sqs'
    );
  }

  /** Runs the SQS application and writes the batch response onto the outer context. */
  protected async handleFunction(
    request: SQSEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
