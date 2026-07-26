import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { addBenzeneMessage } from '@benzene/core-message-handlers';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
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
