/**
 * Port of Benzene.GoogleCloud.Functions.Http.TestHelpers.BenzeneTestHostExtensions — the Google Cloud
 * Functions HTTP specialization step for `benzeneTestHost(...)`. The GCP counterpart of `buildAwsLambdaHost`
 * / `buildAzureFunctionApp`: the ONE transport-/cloud-specific line. Everything before it (`benzeneTestHost`,
 * `.withServices`, `.withConfiguration`) is identical to the AWS/Azure path; only this call and the `as*`
 * builder name change (the consistency law).
 *
 * IDIOM MAP: the C# `BuildGoogleCloudFunctionHost<TStartUp>(this BenzeneTestHostBuilder<TStartUp>)` extension
 * method becomes a **free function taking the builder first** — the port's documented "C# extension method →
 * free function" convention. (The AWS/Azure siblings render their specialization as a fluent
 * `.build*Host()` method via module augmentation; GCF uses the free-function form because its startup's
 * `configure` receives the concrete `GoogleCloudFunctionApplicationBuilder` rather than the unified
 * `IBenzeneApplicationBuilder`, so there is no host-neutral `this` to augment onto — see the README ledger.)
 * It reconstructs the same `GoogleCloudFunctionApplicationBuilder` → `configure` → `build` sequence a real
 * deployment performs (mirroring `GoogleCloudFunctionHost`), returning a ready
 * {@link GoogleCloudFunctionBenzeneTestHost}. The neutral `@benzenejs/testing` core stays free of any cloud
 * import; this package is where the GCF bridge lives.
 */
import { BenzeneTestHostBuilder } from '@benzenejs/testing';
import {
  GoogleCloudFunctionApplicationBuilder,
} from '@benzenejs/google-cloud-functions-http';
import { GoogleCloudFunctionBenzeneTestHost } from './GoogleCloudFunctionBenzeneTestHost';

/**
 * Builds an in-memory {@link GoogleCloudFunctionBenzeneTestHost} from the startup + any `withServices`/
 * `withConfiguration` overrides applied on `builder` — the same construction a real Google Cloud Functions
 * deployment performs, with a seam for test overrides. Send native HTTP requests into it with
 * `host.sendHttpAsync(...)`.
 *
 * @param builder The test host builder (from `benzeneTestHost(MyStartUp)`), with any overrides applied.
 */
export function buildGoogleCloudFunctionHost(
  builder: BenzeneTestHostBuilder<GoogleCloudFunctionApplicationBuilder>,
): GoogleCloudFunctionBenzeneTestHost {
  return builder.build(({ startUp, container, configuration }) => {
    const appBuilder = new GoogleCloudFunctionApplicationBuilder(container);
    startUp.configure(appBuilder, configuration);
    const handler = appBuilder.build(container.createServiceResolverFactory());
    return new GoogleCloudFunctionBenzeneTestHost(handler);
  });
}
