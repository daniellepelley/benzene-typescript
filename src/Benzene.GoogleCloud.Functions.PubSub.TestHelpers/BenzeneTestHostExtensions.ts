/**
 * Port of Benzene.GoogleCloud.Functions.PubSub.TestHelpers.BenzeneTestHostExtensions — the Google Cloud
 * Functions Pub/Sub specialization step for `benzeneTestHost(...)`. The GCP Pub/Sub counterpart of
 * `buildAwsLambdaHost` / `buildAzureFunctionApp` / `buildGoogleCloudFunctionHost`: the ONE transport-/cloud-
 * specific line. Everything before it (`benzeneTestHost`, `.withServices`, `.withConfiguration`) is
 * identical to every other path; only this call and the `as*` builder name change (the consistency law).
 *
 * IDIOM MAP: the C# `BuildGooglePubSubFunctionHost<TStartUp>(this BenzeneTestHostBuilder<TStartUp>)`
 * extension method becomes a **free function taking the builder first** — the port's documented "C#
 * extension method → free function" convention, identical to the HTTP sibling's `buildGoogleCloudFunctionHost`.
 * (The GCF specializations use the free-function form because the startup's `configure` receives the
 * concrete `GooglePubSubFunctionApplicationBuilder` rather than the unified `IBenzeneApplicationBuilder`, so
 * there is no host-neutral `this` to augment onto — see the README ledger.) It reconstructs the same
 * `GooglePubSubFunctionApplicationBuilder` → `configure` → `build` sequence a real deployment performs
 * (mirroring `GooglePubSubFunctionHost`), returning a ready {@link GooglePubSubFunctionBenzeneTestHost}. The
 * neutral `@benzene/testing` core stays free of any cloud import; this package is where the GCF Pub/Sub
 * bridge lives.
 */
import { BenzeneTestHostBuilder } from '@benzene/testing';
import { GooglePubSubFunctionApplicationBuilder } from '@benzene/google-cloud-functions-pubsub';
import { GooglePubSubFunctionBenzeneTestHost } from './GooglePubSubFunctionBenzeneTestHost';

/**
 * Builds an in-memory {@link GooglePubSubFunctionBenzeneTestHost} from the startup + any `withServices`/
 * `withConfiguration` overrides applied on `builder` — the same construction a real Google Cloud Functions
 * Pub/Sub deployment performs, with a seam for test overrides. Send native Pub/Sub payloads into it with
 * `host.sendPubSubAsync(...)`.
 *
 * @param builder The test host builder (from `benzeneTestHost(MyStartUp)`), with any overrides applied.
 */
export function buildGooglePubSubFunctionHost(
  builder: BenzeneTestHostBuilder<GooglePubSubFunctionApplicationBuilder>,
): GooglePubSubFunctionBenzeneTestHost {
  return builder.build(({ startUp, container, configuration }) => {
    const appBuilder = new GooglePubSubFunctionApplicationBuilder(container);
    startUp.configure(appBuilder, configuration);
    const app = appBuilder.build(container.createServiceResolverFactory());
    return new GooglePubSubFunctionBenzeneTestHost(app);
  });
}
