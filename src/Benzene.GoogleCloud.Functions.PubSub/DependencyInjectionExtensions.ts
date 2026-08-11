/** Port of Benzene.GoogleCloud.Functions.PubSub.DependencyInjectionExtensions (C# extension methods -> free functions). */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzene/abstractions';
import {
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  ITransportInfo,
  TransportNames,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IBenzeneApplicationBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import {
  addHeaderMessageVersionGetter,
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { EntryPointMiddlewareApplication } from '@benzene/core-middleware';
import { MessagePublishedData } from './MessagePublishedData';
import { GooglePubSubFunctionApplicationBuilder } from './GooglePubSubFunctionApplicationBuilder';
import { PubSubContext } from './PubSubContext';
import { PubSubMessageBodyGetter } from './PubSubMessageBodyGetter';
import { PubSubMessageHandlerResultSetter } from './PubSubMessageHandlerResultSetter';
import { PubSubMessageHeadersGetter } from './PubSubMessageHeadersGetter';
import { PubSubMessageTopicGetter } from './PubSubMessageTopicGetter';
import { PubSubMiddlewareApplication } from './PubSubMiddlewareApplication';
import { PubSubOptions } from './PubSubOptions';

/**
 * Registers the services required to process a Pub/Sub-triggered message: the topic getter (reading the
 * configurable topic attribute, default `"topic"`), the header message-version getter, the
 * headers/body getters, the result setter, media-format negotiation, the request mapper, and a
 * `"pubsub"` `ITransportInfo`. Called automatically by `usePubSub`; you don't normally call it directly.
 *
 * FAITHFUL TO .NET: like the .NET `AddGooglePubSub`, this registers the PLAIN `PubSubMessageTopicGetter`
 * — NO `PresetTopicMessageTopicGetter`/`PresetTopicHolder` wrapping. Preset-topic override is not
 * implemented for this package yet (a subscription whose producer never sets a `"topic"` attribute
 * routes as `<missing>`); adding it is a small, additive follow-up, matching the .NET package's own
 * deferral. `addMediaFormatNegotiation` + the request-mapper registration are per-transport in the
 * TypeScript port (`useMessageHandlers` resolves them from the container per pipeline), mirroring the
 * other ported triggers (`addServiceBus`, `addRabbitMqConsumer`).
 *
 * @param services The service container to register services with.
 * @param topicAttributeKey The message attribute the topic is read from (see
 *   {@link PubSubMessageTopicGetter.DefaultTopicAttribute}). Defaults to `"topic"`.
 */
export function addGooglePubSub(
  services: IBenzeneServiceContainer,
  topicAttributeKey: string = PubSubMessageTopicGetter.DefaultTopicAttribute,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new PubSubMessageTopicGetter(topicAttributeKey) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<PubSubContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new PubSubMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new PubSubMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new PubSubMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<PubSubContext>(services);

  services.addScopedFactory(
    IRequestMapper,
    (resolver) =>
      new MultiSerializerOptionsRequestMapper(
        resolver.getService(IMediaFormatNegotiator),
        resolver,
        resolver.getService(IMessageBodyGetter),
        resolver.getServices(IRequestEnricher),
      ) as IRequestMapper<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.PubSub));
  return services;
}

/**
 * Configures the Pub/Sub middleware pipeline a Google Cloud Functions Pub/Sub trigger dispatches
 * through, and registers the entry point application that runs it.
 *
 * Port of C# `UsePubSub(this IBenzeneApplicationBuilder, ...)`. Takes the unified
 * `IBenzeneApplicationBuilder` (what a `BenzeneStartUp.configure(app)` receives) and narrows to the
 * concrete {@link GooglePubSubFunctionApplicationBuilder} internally — the `useAwsLambda`/`useAzureFunctions`
 * shape (`app is …` → `instanceof`), a NO-OP on any other builder (e.g. the HTTP host's builder). So the
 * unified `useGoogleCloud(app, g => usePubSub(g, pubsub => …))` and the legacy
 * `configure(app: GooglePubSubFunctionApplicationBuilder)` both wire the SAME pipeline; a mis-paired verb
 * leaves no Pub/Sub pipeline, so the builder's `build()` throws its "No Pub/Sub pipeline configured" error.
 * Registers the Pub/Sub services, builds the per-message `PubSubContext` pipeline from `action`, then adds a
 * single-message `PubSubMiddlewareApplication` (wrapped in an `EntryPointMiddlewareApplication`) over it.
 * The startup's `configureServices` must have registered the Benzene core (`addBenzene`).
 *
 * @param app The unified application builder passed to the startup's `configure` (via `useGoogleCloud`).
 * @param action Configures the Pub/Sub middleware pipeline (e.g. `(pubsub) => useMessageHandlers(pubsub, ...)`).
 * @param configure Optionally configures `PubSubOptions` (e.g. `catchExceptions` / `raiseOnFailureStatus`).
 * @param topicAttributeKey The message attribute the topic is read from. Defaults to `"topic"`.
 * @returns `app`, for chaining.
 */
export function usePubSub(
  app: IBenzeneApplicationBuilder,
  action: PipelineBuilderAction<PubSubContext>,
  configure?: (options: PubSubOptions) => void,
  topicAttributeKey: string = PubSubMessageTopicGetter.DefaultTopicAttribute,
): IBenzeneApplicationBuilder {
  if (!(app instanceof GooglePubSubFunctionApplicationBuilder)) {
    return app;
  }

  app.register((x) => addGooglePubSub(x, topicAttributeKey));
  const pipeline = app.create<PubSubContext>();
  action(pipeline);
  const options = new PubSubOptions();
  configure?.(options);
  app.add(
    (serviceResolverFactory) =>
      new EntryPointMiddlewareApplication<MessagePublishedData>(
        new PubSubMiddlewareApplication(pipeline.build(), options),
        serviceResolverFactory,
      ),
  );
  return app;
}
