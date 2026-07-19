import { describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { IBenzeneInvocation } from '@benzene/abstractions-middleware';
import { BenzeneApplicationBuilder, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  AwsEventStreamContext,
  AwsLambdaApplicationBuilder,
  ILambdaContext,
  useAwsLambda,
  useBenzeneInvocation,
} from '@benzene/aws-lambda-core';

/**
 * Port of the AWS Lambda BenzeneInvocation + AwsLambdaApplicationBuilder scenarios: the AWS
 * `useBenzeneInvocation` overload builds an invocation carrying the Lambda request id and the native
 * `Context` feature; `AwsLambdaApplicationBuilder`/`useAwsLambda` expose and configure the event pipeline.
 */

describe('AwsLambdaBenzeneInvocationTest', () => {
  it('useBenzeneInvocation exposes the Lambda request id, platform, and ILambdaContext feature', async () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);

    let seen: IBenzeneInvocation | undefined;
    useBenzeneInvocation(builder).useFn(async (_context, next, resolver) => {
      seen = resolver.getService(IBenzeneInvocation);
      await next();
    });

    const lambdaContext = { awsRequestId: 'aws-req-1' } as Context;
    const factory = container.createServiceResolverFactory();
    const resolver = factory.createScope();
    await builder.build().handleAsync(new AwsEventStreamContext({}, lambdaContext), resolver);
    resolver.dispose();
    factory.dispose();

    expect(seen).toBeDefined();
    expect(seen!.invocationId).toBe('aws-req-1');
    expect(seen!.platform).toBe('AwsLambda');
    expect(seen!.getFeature(ILambdaContext)).toBe(lambdaContext);
  });

  it('AwsLambdaApplicationBuilder exposes the platform, event pipeline, and configures via useAwsLambda', () => {
    const container = new DefaultBenzeneServiceContainer();
    const eventPipeline = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);
    const appBuilder = new AwsLambdaApplicationBuilder(eventPipeline, container);

    expect(AwsLambdaApplicationBuilder.platformName).toBe('AwsLambda');
    expect(appBuilder.platform).toBe('AwsLambda');
    expect(appBuilder.eventPipeline).toBe(eventPipeline);

    let configured: MiddlewarePipelineBuilder<AwsEventStreamContext> | undefined;
    useAwsLambda(appBuilder, (pipeline) => {
      configured = pipeline as MiddlewarePipelineBuilder<AwsEventStreamContext>;
    });
    expect(configured).toBe(eventPipeline);
  });

  it('useAwsLambda is a no-op on a non-AWS application builder', () => {
    const container = new DefaultBenzeneServiceContainer();
    const otherBuilder = new BenzeneApplicationBuilder('Worker', container);

    let configured = false;
    useAwsLambda(otherBuilder, () => {
      configured = true;
    });
    expect(configured).toBe(false);
  });
});
