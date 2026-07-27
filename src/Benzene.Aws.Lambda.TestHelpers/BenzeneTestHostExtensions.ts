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
 * its `as*` builders) is what lights the method up. A `this` constraint pins it to AWS startups, so it is
 * only callable on a builder whose startup configures the AWS pipeline. It returns the ready
 * {@link AwsLambdaBenzeneTestHost} directly (the .NET version returns the bare entry point and asks the
 * caller to wrap it — folding the wrap in matches the `host.sendEventAsync(...)` shape).
 */
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaEntryPoint } from '@benzene/aws-lambda-core';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneStartUp, BenzeneTestHostBuilder } from '@benzene/testing';
import { AwsLambdaBenzeneTestHost } from './AwsLambdaBenzeneTestHost';

/**
 * The startup shape an AWS Lambda test boots from: a {@link BenzeneStartUp} whose `configure` receives the
 * `AwsEventStreamContext` pipeline builder (wire transports on it with `useApiGateway`, `useSqs`, …). Pins
 * `TAppBuilder` so a developer never writes the generic by hand.
 */
export type AwsLambdaStartUp = BenzeneStartUp<IMiddlewarePipelineBuilder<AwsEventStreamContext>>;

declare module '@benzene/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds an in-memory {@link AwsLambdaBenzeneTestHost} from the startup + any `withServices`/
     * `withConfiguration` overrides — the same construction a real AWS Lambda deployment performs, with a
     * seam for test overrides. Send native events into it with `host.sendEventAsync(...)`.
     */
    buildAwsLambdaHost(
      this: BenzeneTestHostBuilder<IMiddlewarePipelineBuilder<AwsEventStreamContext>>,
    ): AwsLambdaBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildAwsLambdaHost = function buildAwsLambdaHost(
  this: BenzeneTestHostBuilder<IMiddlewarePipelineBuilder<AwsEventStreamContext>>,
): AwsLambdaBenzeneTestHost {
  return this.build(({ startUp, container, configuration }) => {
    const eventPipeline = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);
    startUp.configure(eventPipeline, configuration);
    const entryPoint = new AwsLambdaEntryPoint(
      eventPipeline.build(),
      container.createServiceResolverFactory(),
    );
    return new AwsLambdaBenzeneTestHost(entryPoint);
  });
};
