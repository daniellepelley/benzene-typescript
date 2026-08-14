import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import { addBenzeneMessage } from '@benzenejs/core-message-handlers';
import { createMiddlewarePipeline } from '@benzenejs/core-middleware';
import { AwsEventStreamContext } from '../AwsEventStream/AwsEventStreamContext';
import { BenzeneMessageLambdaHandler } from './BenzeneMessageLambdaHandler';

/**
 * Port of Benzene.Aws.Lambda.Core.BenzeneMessage.Extensions (C# fluent extension method -> free function
 * taking the builder as the first argument).
 *
 * Adds direct-invoke BenzeneMessage handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers
 * the BenzeneMessage services, builds the inner `BenzeneMessageContext` pipeline from `action`, and appends
 * a `BenzeneMessageLambdaHandler`. This is what makes a service answer a synchronous Lambda `Invoke`
 * carrying a `{ topic, headers, body }` envelope — the surface the mesh interrogates for `spec`/`healthcheck`.
 * Mirrors the structure of `useApiGateway`/`useSqs`.
 */
export function useBenzeneMessage(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addBenzeneMessage(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use((resolver) => new BenzeneMessageLambdaHandler(pipeline, resolver));
}
