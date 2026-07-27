/** Port of Benzene.GoogleCloud.Functions.Core.GoogleCloudStartUpRunner. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * What {@link GoogleCloudStartUpRunner.bootstrap} hands back: the constructed startup and the service
 * container its `configureServices`/`configure` lifecycle runs against.
 *
 * BOOTSTRAP-SHAPE ADAPTATION: the .NET `Bootstrap<TStartUp>()` returns a 4-tuple
 * `(StartUp, IConfiguration, IServiceCollection, IBenzeneServiceContainer)` — it constructs the startup,
 * reads its `GetConfiguration()`, and builds a `ServiceCollection` (`.AddLogging()`) wrapped in a
 * `MicrosoftBenzeneServiceContainer`. The TypeScript port collapses this to `(startUp, container)`:
 * Node has no `Microsoft.Extensions.Configuration.IConfiguration` (the port's config abstraction is a
 * test-only concern, deferred alongside the generic-host `BenzeneStartUp` — see the README), and the
 * `IServiceCollection`/`IBenzeneServiceContainer` split collapses into the first-party
 * `DefaultBenzeneServiceContainer`, which is BOTH the registration target and the source of the resolver
 * factory — exactly as `InlineAwsLambdaStartUp` / `InlineAzureFunctionStartUp` are adapted for Node.
 */
export interface GoogleCloudBootstrapResult<TStartUp> {
  /** The constructed startup instance whose `configureServices`/`configure` the host will run. */
  readonly startUp: TStartUp;
  /** The service container to register services into and build the resolver factory from. */
  readonly container: IBenzeneServiceContainer;
}

/**
 * Shared bootstrap steps every Google Cloud Functions trigger-type package needs before it can run a
 * startup's `configure` — constructing the startup and preparing the service container its
 * `configureServices`/`configure` lifecycle is run against. Factored out so each trigger-type package
 * (`@benzene/google-cloud-functions-http` and `@benzene/google-cloud-functions-pubsub`) doesn't
 * duplicate it, mirroring why `Benzene.Aws.Lambda.Core` / `@benzene/aws-lambda-core` exist as a shared
 * foundation for their own event-source packages.
 *
 * Deliberately has NO Google-specific dependency at all (no `@google-cloud/functions-framework`) — it's
 * Google-neutral bootstrap plumbing, matching `Benzene.Aws.Lambda.Core`'s minimal-dependency posture.
 * The Functions Framework dependency lives in the trigger-type packages, not here.
 */
export class GoogleCloudStartUpRunner {
  /**
   * Constructs a `TStartUp` and prepares the service container needed to run its
   * `configureServices`/`configure` lifecycle. Port of C# `Bootstrap<TStartUp>()` (see
   * {@link GoogleCloudBootstrapResult} for the tuple-shape adaptation).
   *
   * @param startUpFactory A no-argument constructor for the platform-neutral application definition to
   *   bootstrap — the port of C#'s `where TStartUp : BenzeneStartUp, new()` constraint.
   * @returns The constructed startup and the container to configure it against.
   */
  static bootstrap<TStartUp>(startUpFactory: new () => TStartUp): GoogleCloudBootstrapResult<TStartUp> {
    const startUp = new startUpFactory();
    const container = new DefaultBenzeneServiceContainer();
    return { startUp, container };
  }
}
