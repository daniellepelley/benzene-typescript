import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  AwsEventStreamContext,
  AwsLambdaApplicationBuilder,
  AwsLambdaEntryPoint,
  toLambdaHandler,
} from '@benzene/aws-lambda-core';
import { StartUp } from './startUp';

/**
 * The Lambda entry point AWS invokes. Point your function's handler at `src/handler.handler`
 * (e.g. `Handler: src/handler.handler` in a SAM/serverless/CDK config).
 *
 * This builds the pipeline once on module load (cold start) from the shared `StartUp` — the same
 * composition root the component test boots — and exports the correctly-bound `handler`.
 *
 * `toLambdaHandler(entryPoint)` returns the function AWS calls; do NOT write
 * `export const handler = entryPoint.functionHandlerAsync` — it compiles but detaches `this` and
 * crashes on the first invocation.
 */
function buildHandler() {
  const startUp = new StartUp();
  const configuration = startUp.getConfiguration();

  const container = new DefaultBenzeneServiceContainer();
  startUp.configureServices(container, configuration);

  const eventPipeline = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);
  const appBuilder = new AwsLambdaApplicationBuilder(eventPipeline, container);
  startUp.configure(appBuilder, configuration);

  const entryPoint = new AwsLambdaEntryPoint(
    eventPipeline.build(),
    container.createServiceResolverFactory(),
  );
  return toLambdaHandler(entryPoint);
}

export const handler = buildHandler();
