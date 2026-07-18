/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbLambdaHandler. */
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewareApplicationWithResult } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter } from '@benzene/aws-lambda-core';
import { DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';

/**
 * Routes AWS Lambda invocations whose event is a `DynamoDBStreamEvent` to the DynamoDB Streams middleware
 * pipeline. Added to the outer `AwsEventStreamContext` pipeline by `useDynamoDb`; it only handles the
 * invocation if the event has records whose source is `aws:dynamodb`, otherwise it defers to the next
 * middleware.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: `tryExtractRequest` (inherited from `AwsLambdaMiddlewareRouter`)
 * returns the already-parsed `context.event` as `DynamoDBStreamEvent`; `canHandle` does the real
 * discrimination on `eventSource`. PascalCase mapping: `event.Records` (stays PascalCase in
 * `@types/aws-lambda`), `records[0].eventSource` (record envelope is camelCase).
 *
 * C# `IMiddlewareApplication<DynamoDbEvent, DynamoDbBatchResponse>` maps to
 * `IMiddlewareApplicationWithResult<DynamoDBStreamEvent, DynamoDBBatchResponse>` (the `WithResult` rule).
 */
export class DynamoDbLambdaHandler extends AwsLambdaMiddlewareRouter<DynamoDBStreamEvent> {
  constructor(
    private readonly application: IMiddlewareApplicationWithResult<
      DynamoDBStreamEvent,
      DynamoDBBatchResponse
    >,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
  }

  /** True if the event has at least one record sourced from DynamoDB. */
  protected canHandle(request: DynamoDBStreamEvent): boolean {
    return (
      request?.Records !== undefined &&
      request.Records.length > 0 &&
      request.Records[0].eventSource === 'aws:dynamodb'
    );
  }

  /** Runs the DynamoDB application and writes the batch response onto the outer context. */
  protected async handleFunction(
    request: DynamoDBStreamEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.application.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
