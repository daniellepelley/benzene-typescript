/**
 * Port of the Google Cloud Functions neutral-selection seam — the Google counterpart of AWS's
 * `useAwsLambda` and Azure's `useAzureFunctions` (C# extension methods → free functions).
 */
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';

/**
 * The platform identifier BOTH Google Cloud Functions application builders report through
 * `IBenzeneApplicationBuilder.platform` — the HTTP `GoogleCloudFunctionApplicationBuilder` and the
 * Pub/Sub `GooglePubSubFunctionApplicationBuilder`. Single source of truth: the builders set their
 * `platformName` from this constant, and {@link useGoogleCloud} gates on it.
 */
export const GoogleCloudFunctionsPlatform = 'GoogleCloudFunctions';

/**
 * The neutral Google Cloud selection seam a unified {@link BenzeneStartUp}'s `configure(app)` uses to
 * scope its wiring to Google Cloud Functions — the exact counterpart of `useAwsLambda(app, aws => …)`
 * and `useAzureFunctions(app, az => …)`. Hands the caller the same `IBenzeneApplicationBuilder`, on which
 * they call the trigger verb their host owns — `useHttp(g, http => …)` under `GoogleCloudFunctionHost`,
 * or `usePubSub(g, pubsub => …)` under `GooglePubSubFunctionHost`. No-op on other platforms, so the SAME
 * neutral `StartUp.configure(app, config)` can select Google exactly as it selects AWS/Azure.
 *
 * WHY IT GATES ON `platform`, NOT `instanceof` (documented bend): `useAwsLambda`/`useAzureFunctions` live
 * in the same package as their ONE concrete builder and narrow with `instanceof`. Google has TWO concrete
 * builders and they live in the trigger packages (`-http`, `-pubsub`) that DEPEND ON this core package, so
 * core cannot import them without a cycle. Gating on the shared `platform` constant keeps this seam in the
 * Google-neutral core (zero `@google-cloud/functions-framework` / trigger-package imports), while
 * `useHttp`/`usePubSub` do the final concrete-builder `instanceof` narrow themselves (each no-ops on the
 * other's builder), so a mis-paired verb surfaces as the builder's own "No … pipeline configured" error.
 *
 * @param app The unified application builder the startup's `configure` receives.
 * @param configure Wires the Google trigger pipeline (e.g. `(g) => useHttp(g, http => …)`).
 * @returns `app`, for chaining.
 */
export function useGoogleCloud(
  app: IBenzeneApplicationBuilder,
  configure: (app: IBenzeneApplicationBuilder) => void,
): IBenzeneApplicationBuilder {
  if (app.platform === GoogleCloudFunctionsPlatform) {
    configure(app);
  }
  return app;
}
