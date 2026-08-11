/** Port of Benzene.GoogleCloud.Functions.Http.GoogleCloudFunctionHost. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneStartUpOf } from '@benzene/abstractions-middleware';
import { GoogleCloudStartUpRunner } from '@benzene/google-cloud-functions-core';
import { HttpFunction, Request, Response } from '@google-cloud/functions-framework';
import {
  GoogleCloudFunctionApplicationBuilder,
  GoogleCloudFunctionRequestHandler,
} from './GoogleCloudFunctionApplicationBuilder';

/**
 * The legacy, per-cloud startup shape a Google Cloud Functions HTTP host booted from before the unified
 * {@link BenzeneStartUp} — a minimal two-method contract with no configuration parameter, whose `configure`
 * receives the concrete {@link GoogleCloudFunctionApplicationBuilder}.
 *
 * @deprecated Implement the unified {@link BenzeneStartUp} (`configure(app: IBenzeneApplicationBuilder,
 * config)`) and select Google with `useGoogleCloud(app, g => useHttp(g, …))`, exactly as AWS uses
 * `useAwsLambda` and Azure uses `useAzureFunctions`. This is the SAME `StartUp` shape across every cloud,
 * booted here by `new GoogleCloudFunctionHost(StartUp).httpFunction`. Retained (with `GoogleCloudFunctionHost`
 * still accepting it) for backward compatibility; the neutral builder is a subtype of this contract's
 * `configure` param, so nothing breaks.
 */
export interface GoogleCloudFunctionStartUp {
  /** Registers the service graph. Port of C# `ConfigureServices`. */
  configureServices(services: IBenzeneServiceContainer): void;
  /** Wires the HTTP pipeline. Port of C# `Configure`. */
  configure(app: GoogleCloudFunctionApplicationBuilder): void;
}

/**
 * Hosts a startup as a Google Cloud Functions Gen2 HTTP trigger. Construct it with your startup class
 * and register its {@link httpFunction} with the Functions Framework:
 *
 * ```ts
 * import * as functions from '@google-cloud/functions-framework';
 * const host = new GoogleCloudFunctionHost(MyStartUp);
 * functions.http('benzene', host.httpFunction);
 * ```
 *
 * The `MyStartUp` here is the SAME unified {@link BenzeneStartUp} an AWS/Azure service ships — only its
 * `configure` line differs (`useGoogleCloud(app, g => useHttp(g, http => useMessageHandlers(http, …)))`) —
 * booted by this one-liner exactly as `new AwsLambdaHost(StartUp).lambdaHandler` /
 * `new AzureFunctionHost(StartUp).httpFunction`. The runner threads the startup's optional
 * `getConfiguration()` through `configureServices`/`configure`, so the config path matches the other clouds.
 *
 * Mirrors `Benzene.Aws.Lambda.Core.AwsLambdaHost<TStartUp>` / the .NET `GoogleCloudFunctionHost<TStartUp>`
 * bootstrap shape: `GoogleCloudStartUpRunner.bootstrap(...)` → `configureServices` → `configure` → `build`.
 * The generic accepts BOTH the unified `BenzeneStartUp` (whose `configure` takes the wider
 * `IBenzeneApplicationBuilder`) and a legacy {@link GoogleCloudFunctionStartUp} (whose `configure` takes the
 * concrete builder) — the neutral builder is a subtype of both, and `configure` is contravariant in its
 * builder, so either is assignable to `BenzeneStartUpOf<GoogleCloudFunctionApplicationBuilder>`.
 *
 * HOST-CLASS DECISION (settled with the maintainer): unlike Azure — where the native-handler getter is added
 * to a transport-agnostic core host by module augmentation — Google KEEPS its per-package host classes
 * (`GoogleCloudFunctionHost` / `GooglePubSubFunctionHost`) with their in-package getters. The
 * `new XHost(StartUp).xFunction` API surface is already uniform across clouds; only the builder + startup
 * CONTRACT is neutralized here, not the host location.
 *
 * SDK-MODEL ADAPTATION: the .NET host IS the entry point (it implements the Functions Framework's
 * `IHttpFunction` and AWS/Google reflection-invoke its `HandleAsync`). Node's Functions Framework
 * invokes a registered named handler `(req, res) => ...` instead, so this host EXPOSES that handler via
 * {@link httpFunction} rather than being it — the same shape as `toLambdaHandler` for AWS, and it avoids
 * the detached-`this` trap of passing the method directly.
 */
export class GoogleCloudFunctionHost<
  TStartUp extends BenzeneStartUpOf<GoogleCloudFunctionApplicationBuilder>,
> {
  private readonly handler: GoogleCloudFunctionRequestHandler;

  /**
   * Constructs `TStartUp`, runs its `getConfiguration`/`configureServices`/`configure`, and builds the
   * request handler every invocation dispatches through.
   *
   * @param startUpFactory A no-argument constructor for the startup — the port of C#'s
   *   `where TStartUp : BenzeneStartUp, new()`.
   */
  constructor(startUpFactory: new () => TStartUp) {
    const { startUp, container, configuration } = GoogleCloudStartUpRunner.bootstrap(startUpFactory);
    const appBuilder = new GoogleCloudFunctionApplicationBuilder(container);

    startUp.configureServices(container, configuration);
    startUp.configure(appBuilder, configuration);

    this.handler = appBuilder.build(container.createServiceResolverFactory());
  }

  /**
   * Handles a single HTTP invocation. Port of C# `HandleAsync(HttpContext)`.
   *
   * @param req The Functions Framework HTTP request.
   * @param res The Functions Framework HTTP response.
   */
  handleAsync(req: Request, res: Response): Promise<void> {
    return this.handler(req, res);
  }

  /**
   * The Functions Framework HTTP handler to register with `functions.http(name, host.httpFunction)`. A
   * closure bound to this host (so `this` stays attached), matching the exported-handler shape a Node
   * Functions developer expects.
   */
  get httpFunction(): HttpFunction {
    return (req, res) => this.handler(req, res);
  }
}
