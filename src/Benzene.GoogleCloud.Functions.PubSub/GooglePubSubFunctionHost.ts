/** Port of Benzene.GoogleCloud.Functions.PubSub.GooglePubSubFunctionHost. */
import { IEntryPointMiddlewareApplication, BenzeneStartUpOf } from '@benzenejs/abstractions-middleware';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { withStartUpChecks } from '@benzenejs/core-message-handlers';
import { GoogleCloudStartUpRunner } from '@benzenejs/google-cloud-functions-core';
import { CloudEvent, CloudEventFunction } from '@google-cloud/functions-framework';
import { MessagePublishedData } from './MessagePublishedData';
import { GooglePubSubFunctionApplicationBuilder } from './GooglePubSubFunctionApplicationBuilder';

/**
 * The legacy, per-cloud startup shape a Google Cloud Functions Pub/Sub host booted from before the unified
 * {@link BenzeneStartUp} — a minimal two-method contract with no configuration parameter, whose `configure`
 * receives the concrete {@link GooglePubSubFunctionApplicationBuilder}.
 *
 * @deprecated Implement the unified {@link BenzeneStartUp} (`configure(app: IBenzeneApplicationBuilder,
 * config)`) and select Google with `useGoogleCloud(app, g => usePubSub(g, …))`, exactly as AWS uses
 * `useAwsLambda` and Azure uses `useAzureFunctions`. Retained (with `GooglePubSubFunctionHost` still
 * accepting it) for backward compatibility; the neutral builder is a subtype of this contract's `configure`
 * param, so nothing breaks.
 */
export interface GooglePubSubFunctionStartUp {
  /** Registers the service graph. Port of C# `ConfigureServices`. */
  configureServices(services: IBenzeneServiceContainer): void;
  /** Wires the Pub/Sub pipeline. Port of C# `Configure`. */
  configure(app: GooglePubSubFunctionApplicationBuilder): void;
}

/**
 * Hosts a startup as a Google Cloud Functions Gen2 Pub/Sub CloudEvent trigger. Construct it with your
 * startup class and register its {@link cloudEventFunction} with the Functions Framework:
 *
 * ```ts
 * import * as functions from '@google-cloud/functions-framework';
 * const host = new GooglePubSubFunctionHost(MyStartUp);
 * functions.cloudEvent('benzene', host.cloudEventFunction);
 * ```
 *
 * The `MyStartUp` here is the SAME unified {@link BenzeneStartUp} shape every other cloud ships — only its
 * `configure` line differs (`useGoogleCloud(app, g => usePubSub(g, pubsub => …))`). The generic accepts
 * BOTH the unified `BenzeneStartUp` and a legacy {@link GooglePubSubFunctionStartUp}, exactly as the HTTP
 * host does (see its notes on the contravariant `BenzeneStartUpOf<GooglePubSubFunctionApplicationBuilder>`
 * constraint and the settled keep-the-per-package-host decision).
 *
 * Mirrors {@link GoogleCloudFunctionHost}'s bootstrap shape for the Pub/Sub CloudEvent trigger type
 * instead of HTTP: `GoogleCloudStartUpRunner.bootstrap(...)` → `configureServices` → `configure` →
 * `build`. Pub/Sub delivers EXACTLY ONE message per invocation, so this is a single-message trigger.
 *
 * SDK-MODEL ADAPTATION: the .NET host IS the entry point (implements the Functions Framework's
 * `ICloudEventFunction<MessagePublishedData>`). Node's Functions Framework invokes a registered named
 * handler `(cloudEvent) => ...`, so this host EXPOSES that handler via {@link cloudEventFunction} rather
 * than being it (same rationale as the HTTP host / `toLambdaHandler`).
 */
export class GooglePubSubFunctionHost<
  TStartUp extends BenzeneStartUpOf<GooglePubSubFunctionApplicationBuilder>,
> {
  private readonly app: IEntryPointMiddlewareApplication<MessagePublishedData>;

  /**
   * Constructs `TStartUp`, runs its `getConfiguration`/`configureServices`/`configure`, and builds the entry
   * point application every invocation dispatches through.
   *
   * @param startUpFactory A no-argument constructor for the startup — the port of C#'s
   *   `where TStartUp : BenzeneStartUp, new()`.
   */
  constructor(startUpFactory: new () => TStartUp) {
    const { startUp, container, configuration } = GoogleCloudStartUpRunner.bootstrap(startUpFactory);
    const appBuilder = new GooglePubSubFunctionApplicationBuilder(container);

    startUp.configureServices(container, configuration);
    startUp.configure(appBuilder, configuration);

    this.app = appBuilder.build(withStartUpChecks(container.createServiceResolverFactory()));
  }

  /**
   * Handles a single Pub/Sub CloudEvent invocation. Port of C# `HandleAsync(CloudEvent, MessagePublishedData, CancellationToken)`
   * — the CloudEvent envelope is unused beyond its `data`, matching the .NET signature.
   *
   * @param cloudEvent The Pub/Sub CloudEvent whose `data` is the `MessagePublishedData` payload.
   * @throws {Error} The CloudEvent carries no Pub/Sub data payload.
   */
  handleAsync(cloudEvent: CloudEvent<MessagePublishedData>): Promise<void> {
    if (cloudEvent.data === undefined) {
      throw new Error('CloudEvent has no Pub/Sub data payload.');
    }
    return this.app.sendAsync(cloudEvent.data);
  }

  /**
   * The Functions Framework CloudEvent handler to register with
   * `functions.cloudEvent(name, host.cloudEventFunction)`. A closure bound to this host so `this` stays
   * attached.
   */
  get cloudEventFunction(): CloudEventFunction<MessagePublishedData> {
    return (cloudEvent) => this.handleAsync(cloudEvent);
  }
}
