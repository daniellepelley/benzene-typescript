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
 * intact. The neutral `@benzenejs/testing` core stays free of any cloud import; importing this package (for
 * its `as*` builders) is what lights the method up. A `this` constraint pins it to a startup whose
 * `configure` receives the unified `IBenzeneApplicationBuilder`. It returns the ready
 * {@link AwsLambdaBenzeneTestHost} directly (the .NET version returns the bare entry point and asks the
 * caller to wrap it — folding the wrap in matches the `host.sendEventAsync(...)` shape).
 */
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { AwsLambdaStartUpRunner } from '@benzenejs/aws-lambda-core';
import { BenzeneTestHostBuilder } from '@benzenejs/testing';
import { AwsLambdaBenzeneTestHost } from './AwsLambdaBenzeneTestHost';

declare module '@benzenejs/testing' {
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
    // Dispatch the `configure` → build-entry-point step through the SAME shared runner the production
    // `AwsLambdaHost` uses, so the test host boots byte-for-byte what deploys. The neutral test builder
    // has already constructed the startup, run `configureServices`, and applied any `withServices`
    // overrides on `container`; this finishes the boot.
    const entryPoint = AwsLambdaStartUpRunner.buildEntryPoint(startUp, container, configuration);
    return new AwsLambdaBenzeneTestHost(entryPoint);
  });
};
