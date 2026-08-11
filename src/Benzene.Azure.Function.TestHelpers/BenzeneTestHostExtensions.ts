/**
 * Port of Benzene.Azure.Function.Core.TestHelpers.BenzeneTestHostExtensions — the Azure Functions
 * specialization step for `benzeneTestHost(...)`. The Azure counterpart of `buildAwsLambdaHost`: the ONE
 * transport-/cloud-specific line. Everything before it is identical to the AWS path; only this call and
 * the `as*` builder name change (the consistency law).
 *
 * IDIOM MAP: same shape as the AWS side — the C# `BuildAzureFunctionApp` extension method becomes a fluent
 * builder method added by module augmentation + prototype assignment. It dispatches the
 * `configure` → build-app step through the SAME shared {@link AzureFunctionStartUpRunner.buildEntryPoint}
 * seam the production {@link AzureFunctionHost} uses, so the test host boots byte-for-byte what deploys
 * (exactly as `buildAwsLambdaHost` was factored in Stage 1).
 *
 * BACKWARD-COMPATIBLE OVERLOAD: because the neutral `AzureFunctionApplicationBuilder` the runner builds is
 * BOTH an `IBenzeneApplicationBuilder` and an `IAzureFunctionAppBuilder`, this method serves both a
 * unified `BenzeneStartUp` (whose `configure` takes `IBenzeneApplicationBuilder` and selects Azure with
 * `useAzureFunctions(app, az => …)`) and a legacy `BenzeneStartUpOf<IAzureFunctionAppBuilder>` (whose
 * `configure` takes the Azure app builder directly). The two `this`-typed overloads pin whichever builder
 * type `benzeneTestHost(StartUp)` inferred, so a developer never writes the generic by hand.
 */
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { IAzureFunctionAppBuilder, AzureFunctionStartUpRunner } from '@benzene/azure-function-core';
import { BenzeneStartUpOf, BenzeneTestHostBuilder } from '@benzene/testing';
import { AzureFunctionBenzeneTestHost } from './AzureFunctionBenzeneTestHost';

/**
 * The legacy startup shape an Azure Functions test can still boot from: a startup whose `configure`
 * receives the `IAzureFunctionAppBuilder` directly (wire triggers on it with `useAzureHttp`,
 * `useServiceBus`, …). Pins `TAppBuilder` so a developer never writes the generic by hand.
 *
 * @deprecated Implement the non-generic `BenzeneStartUp` from `@benzene/testing`: `configure` then
 * receives an `IBenzeneApplicationBuilder` and you select Azure with `useAzureFunctions(app, az => …)`,
 * exactly as the AWS startups select AWS with `useAwsLambda(app, …)`. Both shapes are accepted by
 * `buildAzureFunctionApp`; this alias remains for existing Azure test startups.
 */
export type AzureFunctionStartUp = BenzeneStartUpOf<IAzureFunctionAppBuilder>;

declare module '@benzene/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds an in-memory {@link AzureFunctionBenzeneTestHost} from the startup + any `withServices`/
     * `withConfiguration` overrides — the same construction a real Azure Functions deployment performs,
     * with a seam for test overrides. Send native trigger payloads into it with `host.sendEventAsync(...)`.
     *
     * Accepts both a unified `BenzeneStartUp` (`configure(app: IBenzeneApplicationBuilder)`, select Azure
     * with `useAzureFunctions(app, az => …)`) and a legacy startup whose `configure` takes the
     * `IAzureFunctionAppBuilder` directly.
     */
    buildAzureFunctionApp(
      this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
    ): AzureFunctionBenzeneTestHost;
    buildAzureFunctionApp(
      this: BenzeneTestHostBuilder<IAzureFunctionAppBuilder>,
    ): AzureFunctionBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildAzureFunctionApp = function buildAzureFunctionApp(
  this:
    | BenzeneTestHostBuilder<IBenzeneApplicationBuilder>
    | BenzeneTestHostBuilder<IAzureFunctionAppBuilder>,
): AzureFunctionBenzeneTestHost {
  return (this as BenzeneTestHostBuilder<IAzureFunctionAppBuilder>).build(
    ({ startUp, container, configuration }) => {
      // Same shared runner the production `AzureFunctionHost` uses; the neutral test builder has already
      // constructed the startup, run `configureServices`, and applied any `withServices` overrides.
      const app = AzureFunctionStartUpRunner.buildEntryPoint(startUp, container, configuration);
      return new AzureFunctionBenzeneTestHost(app);
    },
  );
};
