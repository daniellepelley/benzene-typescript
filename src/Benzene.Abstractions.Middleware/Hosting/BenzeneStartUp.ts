import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from './IBenzeneApplicationBuilder';
import { BenzeneConfiguration } from './BenzeneConfiguration';

/**
 * The platform-neutral startup contract every Benzene host boots from — the TypeScript counterpart of
 * .NET's `BenzeneStartUp` (`Benzene.Microsoft.Dependencies.BenzeneStartUp :
 * IStartUp<IServiceCollection, IConfiguration, IBenzeneApplicationBuilder>`). A developer's real startup
 * implements it once and runs unchanged on any host: `configureServices` registers the service graph and
 * `configure` wires the transport pipeline(s), both handed the merged {@link BenzeneConfiguration}.
 *
 * `configure` receives one {@link IBenzeneApplicationBuilder} — the unified, non-generic app builder,
 * exactly like .NET — and the transport is chosen *inside* `configure` by which verb you call
 * (`useAwsLambda(app, aws => …)`, `useWorker(app, …)`). This is what lets a single `StartUp` be built for
 * any platform and read top-to-bottom, and removes the per-transport generic a developer used to write.
 *
 * SHARED CONTRACT: this is the ONE contract the in-memory `benzeneTestHost(StartUp)` and the production
 * `AwsLambdaHost<TStartUp>` both consume, so what a component test boots is exactly what deploys. It lives
 * in `@benzenejs/abstractions-middleware` (the neutral hosting-abstractions package, alongside
 * {@link IStartUp} and {@link IBenzeneApplicationBuilder}) rather than in `@benzenejs/testing`, so a
 * production host never depends on the testing package. `@benzenejs/testing` re-exports it unchanged.
 *
 * BEND FROM .NET: `getConfiguration` is optional here (`IStartUp.GetConfiguration()` is required). A host
 * treats an absent `getConfiguration` as {@link emptyConfiguration}, so the many startups that read only
 * `process.env` need not implement it. Faithful otherwise.
 */
export interface BenzeneStartUp {
  /** Optional: produces the configuration threaded into `configureServices`/`configure`. */
  getConfiguration?(): BenzeneConfiguration;

  /** Registers the service graph. Port of C# `ConfigureServices`. */
  configureServices(services: IBenzeneServiceContainer, configuration: BenzeneConfiguration): void;

  /** Wires the transport pipeline(s) on the unified app builder. Port of C# `Configure`. */
  configure(app: IBenzeneApplicationBuilder, configuration: BenzeneConfiguration): void;
}

/**
 * The legacy, transport-generic startup contract, where `configure` receives the per-transport pipeline
 * builder directly (e.g. an Azure startup's takes the Azure app builder). The AWS startups have migrated
 * to the non-generic {@link BenzeneStartUp}; this remains for the `AzureFunctionStartUp` consumers, whose
 * app-builder unification is still deferred.
 *
 * @deprecated Implement the non-generic {@link BenzeneStartUp}; `configure` now receives an
 * `IBenzeneApplicationBuilder` and the transport is selected with `useAwsLambda(app, …)` etc. This alias
 * is removed once every transport's test startups are migrated (Azure remaining).
 */
export interface BenzeneStartUpOf<TAppBuilder> {
  getConfiguration?(): BenzeneConfiguration;
  configureServices(services: IBenzeneServiceContainer, configuration: BenzeneConfiguration): void;
  configure(app: TAppBuilder, configuration: BenzeneConfiguration): void;
}

/**
 * A no-argument constructor for a startup — the port of C#'s `where TStartUp : new()`. Accepts both the
 * non-generic {@link BenzeneStartUp} (whose `TAppBuilder` is `IBenzeneApplicationBuilder`) and a legacy
 * {@link BenzeneStartUpOf} during the transition.
 */
export type BenzeneStartUpConstructor<TAppBuilder> = new () => BenzeneStartUpOf<TAppBuilder>;
