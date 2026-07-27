/** Port of Benzene.GoogleCloud.Functions.Http.GoogleCloudFunctionHost. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { GoogleCloudStartUpRunner } from '@benzene/google-cloud-functions-core';
import { HttpFunction, Request, Response } from '@google-cloud/functions-framework';
import {
  GoogleCloudFunctionApplicationBuilder,
  GoogleCloudFunctionRequestHandler,
} from './GoogleCloudFunctionApplicationBuilder';

/**
 * The startup shape a Google Cloud Functions HTTP host boots from — the Node analog of C#'s
 * `BenzeneStartUp` as consumed by `GoogleCloudFunctionHost<TStartUp> where TStartUp : BenzeneStartUp`.
 *
 * STARTUP-CONTRACT ADAPTATION: the port's platform-neutral generic-host `BenzeneStartUp` (with its
 * `IConfiguration` thread) is deferred (see the README's AWS/Azure host notes), so — matching
 * `InlineAzureFunctionStartUp` — this is a minimal two-method contract with no configuration parameter.
 * `configureServices` registers the service graph (call `addBenzene(...)`), and `configure` wires the
 * HTTP pipeline against the {@link GoogleCloudFunctionApplicationBuilder} (call `useHttp(app, ...)`).
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
 * Mirrors `Benzene.Aws.Lambda.Core.AwsLambdaHost<TStartUp>` / the .NET
 * `GoogleCloudFunctionHost<TStartUp>` bootstrap shape: `GoogleCloudStartUpRunner.bootstrap(...)` →
 * `configureServices` → `configure` → `build`.
 *
 * SDK-MODEL ADAPTATION: the .NET host IS the entry point (it implements the Functions Framework's
 * `IHttpFunction` and AWS/Google reflection-invoke its `HandleAsync`). Node's Functions Framework
 * invokes a registered named handler `(req, res) => ...` instead, so this host EXPOSES that handler via
 * {@link httpFunction} rather than being it — the same shape as `toLambdaHandler` for AWS, and it avoids
 * the detached-`this` trap of passing the method directly.
 */
export class GoogleCloudFunctionHost<TStartUp extends GoogleCloudFunctionStartUp> {
  private readonly handler: GoogleCloudFunctionRequestHandler;

  /**
   * Constructs `TStartUp`, runs its `configureServices`/`configure`, and builds the request handler
   * every invocation dispatches through.
   *
   * @param startUpFactory A no-argument constructor for the startup — the port of C#'s
   *   `where TStartUp : BenzeneStartUp, new()`.
   */
  constructor(startUpFactory: new () => TStartUp) {
    const { startUp, container } = GoogleCloudStartUpRunner.bootstrap(startUpFactory);
    const appBuilder = new GoogleCloudFunctionApplicationBuilder(container);

    startUp.configureServices(container);
    startUp.configure(appBuilder);

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
