/**
 * Port of Benzene.Aws.Lambda.EventBridge.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext } from '@benzenejs/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzenejs/core-middleware';
import { addEventBridge } from './DependencyInjectionExtensions';
import { EventBridgeApplication } from './EventBridgeApplication';
import { EventBridgeContext } from './EventBridgeContext';
import { EventBridgeLambdaHandler } from './EventBridgeLambdaHandler';
import { EventBridgeOptions } from './EventBridgeOptions';

/**
 * Adds EventBridge handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the EventBridge
 * services, builds the inner single-event `EventBridgeContext` pipeline from `action`, and appends an
 * `EventBridgeLambdaHandler` (which runs an `EventBridgeApplication` over that pipeline). Payloads carrying
 * `detail-type` and `source` are routed through the inner pipeline (topic = `detail-type`, body =
 * `detail`); anything else falls through to the next event source adapter. Optionally configure
 * `EventBridgeOptions` — the defaults are safe-by-default (`raiseOnFailureStatus` on, `catchExceptions`
 * off).
 */
export function useEventBridge(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<EventBridgeContext>,
  configure?: (options: EventBridgeOptions) => void,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addEventBridge(x));
  const pipeline = createMiddlewarePipeline(app, action);
  const options = new EventBridgeOptions();
  configure?.(options);
  return app.use(
    (resolver) => new EventBridgeLambdaHandler(new EventBridgeApplication(pipeline, options), resolver),
  );
}
