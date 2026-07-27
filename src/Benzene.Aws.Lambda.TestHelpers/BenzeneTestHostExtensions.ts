/**
 * Port of Benzene.Aws.Lambda.Core.TestHelpers.BenzeneTestHostExtensions — the AWS Lambda specialization
 * step for `benzeneTestHost(...)`. This is the ONE transport-/cloud-specific line in an otherwise neutral
 * test setup: everything before it (`benzeneTestHost`, `.withServices`, `.withConfiguration`) is identical
 * to the Azure path; only this call and the `as*` builder name change (the consistency law).
 *
 * IDIOM MAP: the C# `BuildAwsLambdaHost` *extension method* on `BenzeneTestHostBuilder<TStartUp>` becomes a
 * TypeScript **fluent method** added to the builder by module augmentation + a prototype assignment — the
 * port's documented "C# extension method → base-class/fluent-builder member" convention, and the shape
 * that keeps the gold-standard `benzeneTestHost(StartUp).withServices(...).buildAwsLambdaHost()` chain
 * intact. The neutral `@benzene/testing` core stays free of any cloud import; importing this package (for
 * its `as*` builders) is what lights the method up. A `this` constraint pins it to a startup whose
 * `configure` receives the unified `IBenzeneApplicationBuilder`. It returns the ready
 * {@link AwsLambdaBenzeneTestHost} directly (the .NET version returns the bare entry point and asks the
 * caller to wrap it — folding the wrap in matches the `host.sendEventAsync(...)` shape).
 */
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaApplicationBuilder, AwsLambdaEntryPoint } from '@benzene/aws-lambda-core';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneTestHostBuilder } from '@benzene/testing';
import { AwsLambdaBenzeneTestHost } from './AwsLambdaBenzeneTestHost';

declare module '@benzene/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds an in-memory {@link AwsLambdaBenzeneTestHost} from the startup + any `withServices`/
     * `withConfiguration` overrides — the same construction a real AWS Lambda deployment performs, with a
     * seam for test overrides. Send native events into it with `host.sendEventAsync(...)` (or a neutral
     * message with `host.sendBenzeneMessageAsync(...)`).
     *
     * The `this` constraint pins it to a builder whose startup's `configure` receives the unified
     * `IBenzeneApplicationBuilder` (select AWS inside it with `useAwsLambda(app, aws => …)`).
     */
    buildAwsLambdaHost(
      this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
    ): AwsLambdaBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildAwsLambdaHost = function buildAwsLambdaHost(
  this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
): AwsLambdaBenzeneTestHost {
  return this.build(({ startUp, container, configuration }) => {
    const eventPipeline = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);
    // The unified app builder is what a `configure(app)` receives; `useAwsLambda(app, aws => …)` unwraps
    // `app.eventPipeline` as `aws`, so the entry point is built from that one pipeline.
    const appBuilder = new AwsLambdaApplicationBuilder(eventPipeline, container);
    startUp.configure(appBuilder, configuration);
    const entryPoint = new AwsLambdaEntryPoint(
      eventPipeline.build(),
      container.createServiceResolverFactory(),
    );
    return new AwsLambdaBenzeneTestHost(entryPoint);
  });
};
