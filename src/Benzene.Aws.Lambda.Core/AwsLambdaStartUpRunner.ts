import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  BenzeneStartUpOf,
  IBenzeneApplicationBuilder,
  environmentConfiguration,
} from '@benzenejs/abstractions-middleware';
import { withStartUpChecks } from '@benzenejs/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';
import { AwsLambdaApplicationBuilder } from './AwsLambdaApplicationBuilder';
import { AwsLambdaEntryPoint } from './AwsLambdaEntryPoint';

/**
 * The single source of truth for the AWS Lambda boot sequence — the shared runner both the production
 * {@link AwsLambdaHost} and the in-memory `benzeneTestHost(StartUp).buildAwsLambdaHost()` dispatch
 * through, so what a component test boots is byte-for-byte what deploys. Mirrors why
 * `Benzene.GoogleCloud.Functions.Core.GoogleCloudStartUpRunner` exists (a Google-neutral bootstrap helper
 * shared by that cloud's trigger packages).
 *
 * BOOTSTRAP-SHAPE ADAPTATION: the .NET `AwsLambdaHost` inlines the whole sequence in its constructor
 * against `Microsoft.Extensions.DependencyInjection` (`ServiceCollection.AddLogging()` +
 * `MicrosoftBenzeneServiceContainer` + `MicrosoftServiceResolverFactory`). Node has no MEL, so — matching
 * the rest of this port — it uses the first-party `DefaultBenzeneServiceContainer`, which is BOTH the
 * registration target and the source of the resolver factory. The `.RunStartUpChecks()` post-build step
 * the .NET host runs IS ported — `withStartUpChecks(...)` wraps the factory below, in one place for both the
 * production host and the test host. (`.WarmUp()` remains unported — that framework service does not exist
 * in the TS port yet; it is additive and can be inserted here when it lands.)
 */
export class AwsLambdaStartUpRunner {
  /**
   * The full production boot: constructs `TStartUp`, reads its optional `getConfiguration`, registers its
   * services, wires its `configure`, and returns the built entry point. One line for a host constructor.
   *
   * @param startUpFactory A no-argument constructor for the platform-neutral application definition —
   *   the port of C#'s `where TStartUp : BenzeneStartUp, new()` constraint.
   */
  static bootstrap<TStartUp extends BenzeneStartUp>(
    startUpFactory: new () => TStartUp,
  ): AwsLambdaEntryPoint {
    const startUp = new startUpFactory();
    const configuration = startUp.getConfiguration?.() ?? environmentConfiguration();
    const container = new DefaultBenzeneServiceContainer();
    startUp.configureServices(container, configuration);
    return AwsLambdaStartUpRunner.buildEntryPoint(startUp, container, configuration);
  }

  /**
   * The `configure` → build-entry-point half of the boot, factored out as the seam the test host reuses:
   * it constructs the startup and runs `configureServices` (plus its `withServices` overrides) itself,
   * then calls this to finish. `configureServices` must already have run on `container`.
   *
   * @param startUp The constructed startup whose `configure` wires the AWS event pipeline.
   * @param container The container `configureServices` (and any test overrides) has populated.
   * @param configuration The merged configuration threaded into `configure`.
   */
  static buildEntryPoint(
    startUp: BenzeneStartUpOf<IBenzeneApplicationBuilder>,
    container: IBenzeneServiceContainer,
    configuration: BenzeneConfiguration,
  ): AwsLambdaEntryPoint {
    const eventPipeline = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);
    // The unified app builder is what a `configure(app)` receives; `useAwsLambda(app, aws => …)` unwraps
    // `app.eventPipeline` as `aws`, so the entry point is built from that one pipeline.
    const appBuilder = new AwsLambdaApplicationBuilder(eventPipeline, container);
    startUp.configure(appBuilder, configuration);
    // Run the boot-time wiring checks once, on the built factory, before the entry point goes live — a
    // wiring bug fails INIT (and any component test that boots through this same runner) rather than the
    // first message that reaches the broken link.
    return new AwsLambdaEntryPoint(
      eventPipeline.build(),
      withStartUpChecks(container.createServiceResolverFactory()),
    );
  }
}
