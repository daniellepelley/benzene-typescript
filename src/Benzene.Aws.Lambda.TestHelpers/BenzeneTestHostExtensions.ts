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
import { IBenzeneApplicationBuilder, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaApplicationBuilder, AwsLambdaEntryPoint } from '@benzene/aws-lambda-core';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneStartUpOf, BenzeneTestHostBuilder } from '@benzene/testing';
import { AwsLambdaBenzeneTestHost } from './AwsLambdaBenzeneTestHost';

/**
 * The legacy startup shape an AWS Lambda test boots from: a startup whose `configure` receives the
 * `AwsEventStreamContext` pipeline builder directly (wire transports on it with `useApiGateway`, `useSqs`,
 * …). Pins `TAppBuilder` so a developer never writes the generic by hand.
 *
 * @deprecated Implement the non-generic `BenzeneStartUp` from `@benzene/testing` and select the transport
 * inside `configure` with `useAwsLambda(app, aws => …)`. This alias remains for legacy AWS test startups
 * during the migration.
 */
export type AwsLambdaStartUp = BenzeneStartUpOf<IMiddlewarePipelineBuilder<AwsEventStreamContext>>;

declare module '@benzene/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds an in-memory {@link AwsLambdaBenzeneTestHost} from the startup + any `withServices`/
     * `withConfiguration` overrides — the same construction a real AWS Lambda deployment performs, with a
     * seam for test overrides. Send native events into it with `host.sendEventAsync(...)` (or a neutral
     * message with `host.sendBenzeneMessageAsync(...)`).
     *
     * Two `this`-overloads span the transition: the non-generic `BenzeneStartUp` (whose `configure`
     * receives `IBenzeneApplicationBuilder`) and the deprecated legacy startup (whose `configure` receives
     * the raw `AwsEventStreamContext` pipeline builder). Both are handed the same `AwsLambdaApplicationBuilder`
     * — it satisfies both shapes — so the two paths build an identical entry point. The legacy overload is
     * removed once every AWS test startup is migrated.
     */
    buildAwsLambdaHost(
      this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
    ): AwsLambdaBenzeneTestHost;
    /** @deprecated Legacy pipeline-shaped startup overload — migrate to the non-generic `BenzeneStartUp`. */
    buildAwsLambdaHost(
      this: BenzeneTestHostBuilder<IMiddlewarePipelineBuilder<AwsEventStreamContext>>,
    ): AwsLambdaBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildAwsLambdaHost = function buildAwsLambdaHost(
  this:
    | BenzeneTestHostBuilder<IBenzeneApplicationBuilder>
    | BenzeneTestHostBuilder<IMiddlewarePipelineBuilder<AwsEventStreamContext>>,
): AwsLambdaBenzeneTestHost {
  // Both startup shapes are handed the same AwsLambdaApplicationBuilder (it satisfies both), so build
  // through the app-builder instantiation — one cast covers the transition union.
  return (this as BenzeneTestHostBuilder<IBenzeneApplicationBuilder>).build(({ startUp, container, configuration }) => {
    const eventPipeline = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);
    // The unified app builder is what a non-generic `configure(app)` receives; `useAwsLambda(app, aws => …)`
    // unwraps `app.eventPipeline` as `aws`. It also satisfies the legacy pipeline shape (transition
    // scaffold on AwsLambdaApplicationBuilder), so a legacy `configure(app)` calling `useApiGateway(app, …)`
    // runs against the same eventPipeline. Either way the entry point is built from that one pipeline.
    const appBuilder = new AwsLambdaApplicationBuilder(eventPipeline, container);
    startUp.configure(appBuilder, configuration);
    const entryPoint = new AwsLambdaEntryPoint(
      eventPipeline.build(),
      container.createServiceResolverFactory(),
    );
    return new AwsLambdaBenzeneTestHost(entryPoint);
  });
};
