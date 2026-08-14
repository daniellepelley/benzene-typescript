/**
 * Port of Benzene.Aws.Lambda.DynamoDb.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext } from '@benzenejs/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzenejs/core-middleware';
import { addDynamoDb } from './DependencyInjectionExtensions';
import { DynamoDbApplication } from './DynamoDbApplication';
import { DynamoDbLambdaHandler } from './DynamoDbLambdaHandler';
import { DynamoDbRecordContext } from './DynamoDbRecordContext';

/**
 * Adds DynamoDB Streams handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the
 * DynamoDB services, builds the inner per-record `DynamoDbRecordContext` pipeline from `action`, and
 * appends a `DynamoDbLambdaHandler` (which runs a `DynamoDbApplication` over that pipeline). The C#
 * `UseDynamoDb` has no options overload, so neither does this port.
 */
export function useDynamoDb(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<DynamoDbRecordContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addDynamoDb(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use(
    (resolver) => new DynamoDbLambdaHandler(new DynamoDbApplication(pipeline), resolver),
  );
}
