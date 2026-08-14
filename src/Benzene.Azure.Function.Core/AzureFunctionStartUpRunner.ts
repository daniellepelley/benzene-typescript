import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  BenzeneStartUpOf,
  emptyConfiguration,
} from '@benzenejs/abstractions-middleware';
import { withStartUpChecks } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { AzureFunctionApplicationBuilder } from './AzureFunctionApplicationBuilder';
import { IAzureFunctionApp } from './IAzureFunctionApp';

/**
 * The single source of truth for the Azure Functions boot sequence — the shared runner both the production
 * {@link AzureFunctionHost} and the in-memory `benzeneTestHost(StartUp).buildAzureFunctionApp()` dispatch
 * through, so what a component test boots is byte-for-byte what deploys. The Azure counterpart of
 * {@link AwsLambdaStartUpRunner}, and mirrors why `GoogleCloudStartUpRunner` exists.
 *
 * BOOTSTRAP-SHAPE ADAPTATION: identical to the AWS runner — the .NET generic-host bootstrap runs against
 * `Microsoft.Extensions.DependencyInjection`; Node has no MEL, so this uses the first-party
 * `DefaultBenzeneServiceContainer`, which is BOTH the registration target and the source of the resolver
 * factory. The `.WarmUp()` / `.RunStartUpChecks()` post-build steps the .NET host runs are not ported yet;
 * they are additive and can be inserted here in one place for both hosts when they land.
 */
export class AzureFunctionStartUpRunner {
  /**
   * The full production boot: constructs `TStartUp`, reads its optional `getConfiguration`, registers its
   * services, wires its `configure`, and returns the built {@link IAzureFunctionApp}. One line for a host
   * constructor.
   *
   * @param startUpFactory A no-argument constructor for the platform-neutral application definition —
   *   the port of C#'s `where TStartUp : BenzeneStartUp, new()` constraint.
   */
  static bootstrap<TStartUp extends BenzeneStartUp>(
    startUpFactory: new () => TStartUp,
  ): IAzureFunctionApp {
    const startUp = new startUpFactory();
    const configuration = startUp.getConfiguration?.() ?? emptyConfiguration();
    const container = new DefaultBenzeneServiceContainer();
    startUp.configureServices(container, configuration);
    return AzureFunctionStartUpRunner.buildEntryPoint(startUp, container, configuration);
  }

  /**
   * The `configure` → build-app half of the boot, factored out as the seam the test host reuses:
   * `configureServices` must already have run on `container`. Builds the neutral
   * {@link AzureFunctionApplicationBuilder}, runs the startup's `configure` against it, and creates the
   * app from the container's resolver factory.
   *
   * The `startUp` parameter is typed against the concrete `AzureFunctionApplicationBuilder` so it accepts
   * BOTH a unified `BenzeneStartUp` (whose `configure` takes the wider `IBenzeneApplicationBuilder`) and a
   * legacy `BenzeneStartUpOf<IAzureFunctionAppBuilder>` (whose `configure` takes the narrower
   * `IAzureFunctionAppBuilder`) — the neutral builder is a subtype of both, and `configure` is
   * contravariant in its builder, so either supertype-taking signature is assignable here.
   *
   * @param startUp The constructed startup whose `configure` wires the Azure trigger pipeline(s).
   * @param container The container `configureServices` (and any test overrides) has populated.
   * @param configuration The merged configuration threaded into `configure`.
   */
  static buildEntryPoint(
    startUp: BenzeneStartUpOf<AzureFunctionApplicationBuilder>,
    container: IBenzeneServiceContainer,
    configuration: BenzeneConfiguration,
  ): IAzureFunctionApp {
    const appBuilder = new AzureFunctionApplicationBuilder(container);
    startUp.configure(appBuilder, configuration);
    // Boot-time wiring checks run here, on the built factory — shared by the production host and the test
    // host, both of which finish through this method.
    return appBuilder.createApp(withStartUpChecks(container.createServiceResolverFactory()));
  }
}
