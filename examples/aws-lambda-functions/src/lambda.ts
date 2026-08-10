/**
 * Shared entry-point builder: wires Benzene onto the first-party container and hands the pipeline builder
 * to a per-transport `configure` callback, then returns the AWS `handler`. Every function in
 * `src/functions/` is one line over this helper.
 */
import { Handler } from 'aws-lambda';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, InlineAwsLambdaStartUp, toLambdaHandler } from '@benzene/aws-lambda-core';

export function lambdaHandler(
  configure: (app: IMiddlewarePipelineBuilder<AwsEventStreamContext>) => void,
): Handler {
  // No `configureServices` needed: each function's `useMessageHandlers` registers the Benzene baseline
  // (`addBenzene`) idempotently, so the pipeline is fully wired by `configure` alone.
  const entryPoint = new InlineAwsLambdaStartUp().configure(configure).build();

  // `toLambdaHandler` returns the correctly-bound function AWS invokes; assigning
  // `entryPoint.functionHandlerAsync` directly would detach `this` and crash at the first invocation.
  return toLambdaHandler(entryPoint);
}
