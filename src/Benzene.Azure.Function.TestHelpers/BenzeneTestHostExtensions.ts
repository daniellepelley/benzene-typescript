/**
 * Port of Benzene.Azure.Function.Core.TestHelpers.BenzeneTestHostExtensions — the Azure Functions
 * specialization step for `benzeneTestHost(...)`. The Azure counterpart of `buildAwsLambdaHost`: the ONE
 * transport-/cloud-specific line. Everything before it is identical to the AWS path; only this call and
 * the `as*` builder name change (the consistency law).
 *
 * IDIOM MAP: same shape as the AWS side — the C# `BuildAzureFunctionApp` extension method becomes a fluent
 * builder method added by module augmentation + prototype assignment, pinned to Azure startups by a `this`
 * constraint. It reconstructs the same `AzureFunctionAppBuilder` → `configure` → `createApp` sequence a
 * real deployment performs (mirroring `InlineAzureFunctionStartUp`), returning a ready
 * {@link AzureFunctionBenzeneTestHost}.
 */
import { IAzureFunctionAppBuilder, AzureFunctionAppBuilder } from '@benzene/azure-function-core';
import { BenzeneStartUp, BenzeneTestHostBuilder } from '@benzene/testing';
import { AzureFunctionBenzeneTestHost } from './AzureFunctionBenzeneTestHost';

/**
 * The startup shape an Azure Functions test boots from: a {@link BenzeneStartUp} whose `configure`
 * receives the `IAzureFunctionAppBuilder` (wire triggers on it with `useAzureHttp`, `useServiceBus`, …).
 * Pins `TAppBuilder` so a developer never writes the generic by hand.
 */
export type AzureFunctionStartUp = BenzeneStartUp<IAzureFunctionAppBuilder>;

declare module '@benzene/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds an in-memory {@link AzureFunctionBenzeneTestHost} from the startup + any `withServices`/
     * `withConfiguration` overrides — the same construction a real Azure Functions deployment performs,
     * with a seam for test overrides. Send native trigger payloads into it with `host.sendEventAsync(...)`.
     */
    buildAzureFunctionApp(
      this: BenzeneTestHostBuilder<IAzureFunctionAppBuilder>,
    ): AzureFunctionBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildAzureFunctionApp = function buildAzureFunctionApp(
  this: BenzeneTestHostBuilder<IAzureFunctionAppBuilder>,
): AzureFunctionBenzeneTestHost {
  return this.build(({ startUp, container, configuration }) => {
    const appBuilder = new AzureFunctionAppBuilder(container);
    startUp.configure(appBuilder, configuration);
    const app = appBuilder.createApp(container.createServiceResolverFactory());
    return new AzureFunctionBenzeneTestHost(app);
  });
};
