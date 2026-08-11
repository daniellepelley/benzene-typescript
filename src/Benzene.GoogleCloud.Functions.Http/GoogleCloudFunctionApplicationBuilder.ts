/** Port of Benzene.GoogleCloud.Functions.Http.GoogleCloudFunctionApplicationBuilder. */
import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import { BenzeneApplicationBuilder } from '@benzene/core-middleware';
import { GoogleCloudFunctionsPlatform } from '@benzene/google-cloud-functions-core';
import { Request, Response } from '@google-cloud/functions-framework';

/**
 * The functions-framework HTTP handler the built pipeline is dispatched through: a `(req, res)` bridge
 * over the Functions Framework's Express-style request/response, the Node analog of C#'s
 * `Task HandleAsync(HttpContext)`.
 */
export type GoogleCloudFunctionRequestHandler = (req: Request, res: Response) => Promise<void>;

/**
 * The builder a startup's `configure` is run against when hosted on Google Cloud Functions via
 * {@link GoogleCloudFunctionHost}.
 *
 * HOST-MACHINERY ADAPTATION: the .NET original implements `Benzene.AspNet.Core.IAspApplicationBuilder`
 * purely so that stack's existing `UseHttp(IBenzeneApplicationBuilder, ...)` extension treats a Cloud
 * Functions host the same as a real ASP.NET Core one WITHOUT needing a live `IApplicationBuilder`.
 * `Benzene.AspNet.Core` is .NET-specific and is NOT ported — `@benzene/express` is its Node/JS analog
 * (see the README) — and the Functions Framework's HTTP signature is itself Express-shaped
 * (`functions.http(name, (req, res) => ...)`). So the TypeScript builder reuses `@benzene/express`'s
 * already-tested `ExpressContext` + `addExpress` adapter machinery to bridge that req/res into the
 * Benzene HTTP pipeline, exactly as the Express middleware does when invoked — see `useHttp`.
 *
 * Like `Benzene.AspNet.Core.AspApplicationBuilder`, the .NET version's `Add(...)` defers rather than
 * building immediately, because the final `IServiceResolverFactory` isn't ready until after
 * `configureServices`/`configure` both finish. This port keeps that deferred shape: {@link add} stores
 * the handler factory and {@link build} invokes it once {@link GoogleCloudFunctionHost} has the final,
 * fully-configured resolver factory.
 */
export class GoogleCloudFunctionApplicationBuilder extends BenzeneApplicationBuilder {
  /**
   * The platform identifier reported by the base `IBenzeneApplicationBuilder.platform`. Sourced from the
   * shared {@link GoogleCloudFunctionsPlatform} constant so the neutral `useGoogleCloud(app, …)` seam (in
   * `@benzene/google-cloud-functions-core`) can gate on it — this builder IS an `IBenzeneApplicationBuilder`
   * (via `BenzeneApplicationBuilder`), the same one a unified `BenzeneStartUp.configure(app)` receives.
   */
  static readonly platformName = GoogleCloudFunctionsPlatform;

  private handlerFactory?: (
    serviceResolverFactory: IServiceResolverFactory,
  ) => GoogleCloudFunctionRequestHandler;

  /**
   * @param benzeneServiceContainer The service container backing this builder.
   */
  constructor(benzeneServiceContainer: IBenzeneServiceContainer) {
    super(GoogleCloudFunctionApplicationBuilder.platformName, benzeneServiceContainer);
  }

  /**
   * Stores the request-handler factory registered by `useHttp(...)`, deferring construction until
   * {@link build} is called with the final resolver factory. Port of C# `Add`.
   *
   * @param func A factory that creates the request handler given the current resolver factory.
   */
  add(func: (serviceResolverFactory: IServiceResolverFactory) => GoogleCloudFunctionRequestHandler): void {
    this.handlerFactory = func;
  }

  /**
   * Invokes the factory stored by {@link add} to build the request handler every incoming request is
   * dispatched through. Port of C# `Build`.
   *
   * @param serviceResolverFactory The fully-configured service resolver factory to build the handler with.
   * @throws {Error} No HTTP pipeline was configured — the startup's `configure` must call `useHttp(...)`.
   */
  build(serviceResolverFactory: IServiceResolverFactory): GoogleCloudFunctionRequestHandler {
    if (this.handlerFactory === undefined) {
      throw new Error(
        'No HTTP pipeline configured - call useHttp(...) in your BenzeneStartUp.configure implementation.',
      );
    }

    return this.handlerFactory(serviceResolverFactory);
  }
}
