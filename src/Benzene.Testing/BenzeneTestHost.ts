/**
 * Port of Benzene.Testing.BenzeneTestHost / BenzeneTestHostBuilder — the platform-neutral entry point
 * for booting a real Benzene app from its own startup in-memory, overriding any dependency with a fake,
 * and finishing with a single transport-specific specialization step.
 *
 * IDIOM MAP (see `.claude/agents/typescript-test-champion.md`):
 * - C# `BenzeneTestHost.Create<TStartUp>()` (static generic + `new()` constraint) → the `benzeneTestHost`
 *   free function taking the startup's constructor; TypeScript infers the app-builder type structurally
 *   rather than by reflection.
 * - C# `WithServices(Action<IServiceCollection>)` → `.withServices((services) => ...)` over the port's
 *   first-party `IBenzeneServiceContainer`, last-registration-wins so it reaches ANY registration.
 * - C# `WithConfiguration(...)` → `.withConfiguration(key, value)` / `.withConfiguration({ ... })`.
 * - C# `Build<THost>(Func<TStartUp, IServiceCollection, IConfiguration, THost>)` → `.build(factory)`,
 *   the seam each transport's `*.TestHelpers` package calls from its own `build*Host` specialization
 *   (`buildAwsLambdaHost` / `buildAzureFunctionApp`), keeping the neutral core free of cloud imports.
 */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  BenzeneConfiguration,
  emptyConfiguration,
  layerConfiguration,
} from './BenzeneConfiguration';

/**
 * The platform-neutral startup contract the test host boots from — the TypeScript counterpart of .NET's
 * `BenzeneStartUp`. A developer's real startup implements it: `configureServices` registers the service
 * graph and `configure` wires the transport pipeline(s), both handed the merged {@link BenzeneConfiguration}.
 *
 * It is generic over `TAppBuilder` because — unlike the .NET reference, whose transports all share the
 * `IBenzeneApplicationBuilder` generic-host base — the TypeScript port has not yet unified the per-transport
 * application builders (that host bootstrap is deferred; see the README). So an AWS startup's `configure`
 * takes the AWS pipeline builder and an Azure startup's takes the Azure app builder. The convenience aliases
 * `AwsLambdaStartUp` / `AzureFunctionStartUp` in the transport testing packages pin `TAppBuilder`, so a
 * developer never writes the generic by hand.
 */
export interface BenzeneStartUp<TAppBuilder> {
  /** Optional: produces the configuration threaded into `configureServices`/`configure`. */
  getConfiguration?(): BenzeneConfiguration;

  /** Registers the service graph. Port of C# `ConfigureServices`. */
  configureServices(services: IBenzeneServiceContainer, configuration: BenzeneConfiguration): void;

  /** Wires the transport pipeline(s). Port of C# `Configure`. */
  configure(app: TAppBuilder, configuration: BenzeneConfiguration): void;
}

/** A no-argument constructor for a {@link BenzeneStartUp} — the port of C#'s `where TStartUp : new()`. */
export type BenzeneStartUpConstructor<TAppBuilder> = new () => BenzeneStartUp<TAppBuilder>;

/**
 * What a transport's `build*Host` specialization receives from {@link BenzeneTestHostBuilder.build}: the
 * instantiated startup, the container already populated by `configureServices` + any `withServices`
 * overrides, and the merged configuration. Mirrors the `(startUp, services, configuration)` tuple the
 * .NET `Build<THost>(factory)` hands its factory.
 */
export interface BenzeneTestHostContext<TAppBuilder> {
  readonly startUp: BenzeneStartUp<TAppBuilder>;
  readonly container: IBenzeneServiceContainer;
  readonly configuration: BenzeneConfiguration;
}

/**
 * Builds an in-memory test host for a {@link BenzeneStartUp}, with optional configuration and service
 * overrides applied on top of the startup's own registrations. Neutral across every transport and cloud;
 * the only transport-/cloud-specific thing is the terminal `build*Host` call.
 */
export class BenzeneTestHostBuilder<TAppBuilder> {
  private readonly serviceActions: ((services: IBenzeneServiceContainer) => void)[] = [];
  private readonly configOverrides: Record<string, string> = {};

  constructor(private readonly startUpFactory: BenzeneStartUpConstructor<TAppBuilder>) {}

  /**
   * Registers an action that runs AFTER the startup's own `configureServices`, typically to replace a
   * real dependency with a fake or mock. Last-registration-wins, so it reaches any registration.
   */
  withServices(action: (services: IBenzeneServiceContainer) => void): this {
    this.serviceActions.push(action);
    return this;
  }

  /** Overrides a single configuration value on top of the startup's own `getConfiguration()` result. */
  withConfiguration(key: string, value: string): this;
  /** Overrides configuration values on top of the startup's own `getConfiguration()` result. */
  withConfiguration(values: Record<string, string>): this;
  withConfiguration(keyOrValues: string | Record<string, string>, value?: string): this {
    if (typeof keyOrValues === 'string') {
      this.configOverrides[keyOrValues] = value as string;
    } else {
      Object.assign(this.configOverrides, keyOrValues);
    }
    return this;
  }

  /**
   * Runs the startup's `getConfiguration`/`configureServices` plus any overrides, then hands the result
   * to `factory` to build a transport-specific host. The transport `*.TestHelpers` packages call this
   * from their own `build*Host` specialization; they construct the concrete application builder, call
   * `startUp.configure(...)` against it, and wrap the built entry point in a test host.
   */
  build<THost>(factory: (context: BenzeneTestHostContext<TAppBuilder>) => THost): THost {
    const startUp = new this.startUpFactory();
    const baseConfiguration = startUp.getConfiguration?.() ?? emptyConfiguration();
    const configuration = layerConfiguration(baseConfiguration, this.configOverrides);

    const container = new DefaultBenzeneServiceContainer();
    startUp.configureServices(container, configuration);

    for (const action of this.serviceActions) {
      action(container);
    }

    return factory({ startUp, container, configuration });
  }
}

/**
 * Starts building a test host for `startUp`. Call a transport-specific `build*Host` specialization
 * (e.g. `buildAwsLambdaHost` / `buildAzureFunctionApp` from the `*.TestHelpers` packages) to finish.
 * Port of C# `BenzeneTestHost.Create<TStartUp>()`.
 */
export function benzeneTestHost<TAppBuilder>(
  startUp: BenzeneStartUpConstructor<TAppBuilder>,
): BenzeneTestHostBuilder<TAppBuilder> {
  return new BenzeneTestHostBuilder<TAppBuilder>(startUp);
}
