/** Port of Benzene.GoogleCloud.Functions.PubSub.GooglePubSubFunctionHost. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IEntryPointMiddlewareApplication } from '@benzene/abstractions-middleware';
import { GoogleCloudStartUpRunner } from '@benzene/google-cloud-functions-core';
import { CloudEvent, CloudEventFunction } from '@google-cloud/functions-framework';
import { MessagePublishedData } from './MessagePublishedData';
import { GooglePubSubFunctionApplicationBuilder } from './GooglePubSubFunctionApplicationBuilder';

/**
 * The startup shape a Google Cloud Functions Pub/Sub host boots from — the Node analog of C#'s
 * `BenzeneStartUp` as consumed by `GooglePubSubFunctionHost<TStartUp> where TStartUp : BenzeneStartUp`.
 *
 * Minimal two-method contract (no configuration parameter), matching `GoogleCloudFunctionStartUp` and
 * `InlineAzureFunctionStartUp` — see the HTTP host's notes on the deferred generic-host `BenzeneStartUp`.
 * `configureServices` registers the service graph (call `addBenzene(...)`), and `configure` wires the
 * Pub/Sub pipeline against the {@link GooglePubSubFunctionApplicationBuilder} (call `usePubSub(app, ...)`).
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
 * Mirrors {@link GoogleCloudFunctionHost}'s bootstrap shape for the Pub/Sub CloudEvent trigger type
 * instead of HTTP: `GoogleCloudStartUpRunner.bootstrap(...)` → `configureServices` → `configure` →
 * `build`. Pub/Sub delivers EXACTLY ONE message per invocation, so this is a single-message trigger.
 *
 * SDK-MODEL ADAPTATION: the .NET host IS the entry point (implements the Functions Framework's
 * `ICloudEventFunction<MessagePublishedData>`). Node's Functions Framework invokes a registered named
 * handler `(cloudEvent) => ...`, so this host EXPOSES that handler via {@link cloudEventFunction} rather
 * than being it (same rationale as the HTTP host / `toLambdaHandler`).
 */
export class GooglePubSubFunctionHost<TStartUp extends GooglePubSubFunctionStartUp> {
  private readonly app: IEntryPointMiddlewareApplication<MessagePublishedData>;

  /**
   * Constructs `TStartUp`, runs its `configureServices`/`configure`, and builds the entry point
   * application every invocation dispatches through.
   *
   * @param startUpFactory A no-argument constructor for the startup — the port of C#'s
   *   `where TStartUp : BenzeneStartUp, new()`.
   */
  constructor(startUpFactory: new () => TStartUp) {
    const { startUp, container } = GoogleCloudStartUpRunner.bootstrap(startUpFactory);
    const appBuilder = new GooglePubSubFunctionApplicationBuilder(container);

    startUp.configureServices(container);
    startUp.configure(appBuilder);

    this.app = appBuilder.build(container.createServiceResolverFactory());
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
