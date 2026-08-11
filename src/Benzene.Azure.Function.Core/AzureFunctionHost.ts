import { BenzeneStartUp } from '@benzene/abstractions-middleware';
import { AzureFunctionStartUpRunner } from './AzureFunctionStartUpRunner';
import { IAzureFunctionApp } from './IAzureFunctionApp';

/**
 * Port of the .NET Azure Functions generic host (`HostBuilderExtensions.UseBenzene<TStartUp>` /
 * `FunctionsWorkerApplicationBuilderExtensions.UseBenzene`), collapsed to the SDK-model shape Node's
 * isolated-worker programming model needs.
 *
 * Hosts a platform-neutral {@link BenzeneStartUp} as an Azure Functions app. Construct it with your startup
 * class and hand each trigger's native handler to the matching `@azure/functions` registration:
 *
 * ```ts
 * import { app } from '@azure/functions';
 * import { AzureFunctionHost } from '@benzene/azure-function-core';
 * import '@benzene/azure-function-http'; // lights up `.httpFunction` (see below)
 * import { StartUp } from './startUp';
 *
 * const host = new AzureFunctionHost(StartUp);
 * app.http('orders', { methods: ['POST'], authLevel: 'anonymous', handler: host.httpFunction });
 * ```
 *
 * This is the one-liner boot that replaces the hand-built `azureApp(...)` assembly: it constructs
 * `TStartUp`, runs `getConfiguration` → `configureServices` → `configure` (via the shared
 * {@link AzureFunctionStartUpRunner}, the SAME sequence `benzeneTestHost(StartUp).buildAzureFunctionApp()`
 * runs in tests), and exposes the built {@link IAzureFunctionApp} plus the per-trigger native handlers the
 * Functions runtime registers.
 *
 * SDK-MODEL ADAPTATION vs `AwsLambdaHost`: AWS Lambda has ONE entry point that sniffs the event, so
 * `AwsLambdaHost` owns a `.lambdaHandler`. The `@azure/functions` v4 model is per-trigger — each trigger
 * type (HTTP, Service Bus, Event Hub, …) is a separate registration whose payload adaptation lives in its
 * own transport package. So this core host stays transport-agnostic (it exposes the built {@link app} and
 * the two neutral dispatch methods), and each transport package ADDS the native-handler getter it owns —
 * `@benzene/azure-function-http` adds `.httpFunction`, `@benzene/azure-function-service-bus` adds
 * `.serviceBusFunction`, `@benzene/azure-function-event-hub` adds `.eventHubFunction` — via
 * `declare module`, exactly as the `*-testing` packages add `buildAzureFunctionApp` to the test host. A
 * getter lights up only when its transport package is imported (which a trigger registration always does
 * for its `use*` wiring), so core keeps zero transport imports. See each transport package's
 * `AzureFunctionHostExtensions`.
 */
export class AzureFunctionHost<TStartUp extends BenzeneStartUp> {
  private readonly builtApp: IAzureFunctionApp;

  /**
   * Constructs `TStartUp`, runs its `getConfiguration`/`configureServices`/`configure`, and builds the
   * {@link IAzureFunctionApp} every trigger dispatches through.
   *
   * @param startUpFactory A no-argument constructor for the startup — the port of C#'s
   *   `where TStartUp : BenzeneStartUp, new()`.
   */
  constructor(startUpFactory: new () => TStartUp) {
    this.builtApp = AzureFunctionStartUpRunner.bootstrap(startUpFactory);
  }

  /**
   * The built app the per-trigger native-handler getters dispatch to. Also usable directly with the
   * transport `handle*` helpers (`handleHttpRequest(host.app, request)`,
   * `handleServiceBusMessages(host.app, …)`, `handleEventHub(host.app, …)`) when you prefer a free
   * function over the `.httpFunction`-style getter.
   */
  get app(): IAzureFunctionApp {
    return this.builtApp;
  }

  /**
   * Dispatches a request that expects a response (e.g. an HTTP trigger) to the matching entry point.
   * Neutral pass-through to {@link IAzureFunctionApp.handleAsyncWithResult}.
   */
  handleAsyncWithResult<TRequest, TResponse>(request: TRequest): Promise<TResponse> {
    return this.builtApp.handleAsyncWithResult<TRequest, TResponse>(request);
  }

  /**
   * Dispatches a fire-and-forget request (e.g. a Service Bus / Event Hub batch) to the matching entry
   * point. Neutral pass-through to {@link IAzureFunctionApp.handleAsync}.
   */
  handleAsync<TRequest>(request: TRequest): Promise<void> {
    return this.builtApp.handleAsync<TRequest>(request);
  }
}
