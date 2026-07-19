/**
 * Port of Benzene.Aws.Lambda.EventBridge.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { addEventBridge } from './DependencyInjectionExtensions';
import { EventBridgeApplication } from './EventBridgeApplication';
import { EventBridgeContext } from './EventBridgeContext';
import { EventBridgeLambdaHandler } from './EventBridgeLambdaHandler';

/**
 * Adds EventBridge handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the EventBridge
 * services, builds the inner single-event `EventBridgeContext` pipeline from `action`, and appends an
 * `EventBridgeLambdaHandler` (which runs an `EventBridgeApplication` over that pipeline). Payloads carrying
 * `detail-type` and `source` are routed through the inner pipeline (topic = `detail-type`, body =
 * `detail`); anything else falls through to the next event source adapter.
 */
export function useEventBridge(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<EventBridgeContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addEventBridge(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use(
    (resolver) => new EventBridgeLambdaHandler(new EventBridgeApplication(pipeline), resolver),
  );
}
