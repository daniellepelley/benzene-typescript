import {
  Constructor,
  IBenzeneServiceContainer,
  ILoggerFactory,
  ISerializer,
  NullLogger,
  NullLoggerFactory,
  ServiceIdentifier,
  tryAddScoped,
  tryAddScopedFactory,
  tryAddSingleton,
  tryAddSingletonFactory,
} from '@benzene/abstractions';
import {
  IBenzeneResponseAdapter,
  IHandlerMiddlewareBuilder,
  IHandlerPipelineBuilder,
  IMediaFormat,
  IMediaFormatNegotiator,
  IMessageGetter,
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
  IMessageHandlerFactory,
  IMessageHandlerResultSetter,
  IMessageHandlerWrapper,
  IMessageHandlersFinder,
  IMessageHandlersList,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  IResponseHandler,
  IResponseHandlerContainer,
  IResponsePayloadMapper,
  IResponseRenderer,
  IVersionSelector,
} from '@benzene/abstractions-message-handlers';
import {
  IMessageBodyBytesGetter,
  IMessageBodyGetter,
  IMessageHeadersGetter,
} from '@benzene/abstractions-messages';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { addBenzeneMiddleware } from '@benzene/core-middleware';
import { BenzeneMessageGetter } from '../BenzeneMessage/BenzeneBodyMapper';
import { BenzeneMessageMessageHandlerResultSetter } from '../BenzeneMessage/BenzeneMessageMessageHandlerResultSetter';
import { BenzeneMessageResponseAdapter } from '../BenzeneMessage/BenzeneMessageResponseAdapter';
import { DefaultResponseStatusHandler } from '../BenzeneMessage/DefaultResponseStatusHandler';
import { CacheMessageHandlersFinder } from '../CacheMessageHandlersFinder';
import { tryAddHeaderMessageVersionGetter } from '../MessageVersionHeaderNames';
import { CompositeMessageHandlersFinder } from '../CompositeMessageHandlersFinder';
import { DefaultStatuses } from '../DefaultStatuses';
import { DependencyMessageHandlersFinder } from '../DependencyMessageHandlersFinder';
import { HandlerPipelineBuilder } from '../HandlerPipelineBuilder';
import { ApplicationInfo } from '../Info/ApplicationInfo';
import { BlankApplicationInfo } from '../Info/BlankApplicationInfo';
import { CurrentTransportInfo } from '../Info/CurrentTransportInfo';
import { ICurrentTransport, ISetCurrentTransport } from '@benzene/abstractions-message-handlers';
import { IApplicationInfo, ITransportInfo, ITransportsInfo } from '@benzene/abstractions-message-handlers';
import { TransportInfo } from '../Info/TransportInfo';
import { TransportsInfo } from '../Info/TransportsInfo';
import { addMediaFormatNegotiation } from '../MediaFormats/DependencyInjectionExtensions';
import { JsonMediaFormat } from '../MediaFormats/JsonMediaFormat';
import { MediaFormatNegotiator } from '../MediaFormats/MediaFormatNegotiator';
import { MessageGetter } from '../MessageGetter';
import { MessageHandlerDefinitionIndex } from '../MessageHandlerDefinitionIndex';
import { MessageHandlerDefinitionLookUp } from '../MessageHandlerDefinitionLookUp';
import { MessageHandlerFactory } from '../MessageHandlerFactory';
import { MessageHandlersList } from '../MessageHandlersList';
import { IDefaultStatuses } from '../MessageResult';
import { MessageRouter } from '../MessageRouter';
import { PipelineMessageHandlerWrapper } from '../PipelineMessageHandlerWrapper';
import { RegistryMessageHandlersFinder } from '../RegistryMessageHandlersFinder';
import { MultiSerializerOptionsRequestMapper } from '../Request/MultiSerializerOptionsRequestMapper';
import { DefaultResponsePayloadMapper } from '../Response/DefaultResponsePayloadMapper';
import { RendererResponseHandler } from '../Response/RendererResponseHandler';
import { ResponseHandlerContainer } from '../Response/ResponseHandlerContainer';
import { SerializerResponseRenderer } from '../Response/SerializerResponseRenderer';
import { JsonSerializer } from '../Serialization/JsonSerializer';
import { VersionSelector } from '../VersionSelector';

/**
 * Top-level DI registration free functions for wiring up message-handler infrastructure and the
 * transport-agnostic `BenzeneMessage` format.
 * Port of Benzene.Core.MessageHandlers.DI.Extensions (C# extension methods become free functions).
 *
 * DI-under-erasure notes (documented per-registration below): C# open-generic registrations such as
 * `TryAddScoped(typeof(IMessageGetter<>), typeof(MessageGetter<>))` cannot be expressed in
 * TypeScript, which has no open generics and gives each ported interface a single `<unknown>`-typed
 * `ServiceToken`. Since a Benzene app uses ONE context type per pipeline, each such registration
 * becomes a single closed factory registration under the shared token that constructs the concrete
 * `new X(...)` (its `<TContext>` type parameter is erased). Where a C# constructor takes
 * `IEnumerable<T>` we resolve `r.getServices(Token)`; `ILogger<X>` becomes a plain `ILogger`
 * defaulting to `NullLogger.instance`.
 */

/**
 * Registers the services needed to handle messages in the `BenzeneMessage` format: message
 * extraction, result setting, response adaptation, and a default "direct" `ITransportInfo`.
 * Port of C# `AddBenzeneMessage`.
 *
 * Wrinkle 5 (one impl under many tokens): C# registers `BenzeneMessageGetter` separately under
 * `IMessageGetter`, `IMessageBodyGetter`, `IMessageTopicGetter`, `IMessageHeadersGetter` and
 * `IMessageBodyBytesGetter`. The port registers the class once as scoped, then forwards each token to
 * that single scoped instance via `r.getService(BenzeneMessageGetter)`, so all five interfaces share
 * one instance (it is stateless, so this is behaviourally identical and cleaner than five separate
 * `new`-ing registrations).
 */
export function addBenzeneMessage(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddHeaderMessageVersionGetter<BenzeneMessageContext>(services);
  tryAddScoped(services, BenzeneMessageGetter);
  tryAddScopedFactory(services, IMessageGetter, (r) =>
    r.getService(BenzeneMessageGetter) as unknown as IMessageGetter<unknown>,
  );
  tryAddScopedFactory(services, IMessageBodyGetter, (r) =>
    r.getService(BenzeneMessageGetter) as unknown as IMessageBodyGetter<unknown>,
  );
  tryAddScopedFactory(services, IMessageTopicGetter, (r) =>
    r.getService(BenzeneMessageGetter) as unknown as IMessageTopicGetter<unknown>,
  );
  tryAddScopedFactory(services, IMessageHeadersGetter, (r) =>
    r.getService(BenzeneMessageGetter) as unknown as IMessageHeadersGetter<unknown>,
  );
  tryAddScopedFactory(services, IMessageBodyBytesGetter, (r) =>
    r.getService(BenzeneMessageGetter) as unknown as IMessageBodyBytesGetter<unknown>,
  );

  tryAddScopedFactory(services, IMessageHandlerResultSetter, (r) =>
    new BenzeneMessageMessageHandlerResultSetter(
      r.getService(IResponseHandlerContainer) as IResponseHandlerContainer<BenzeneMessageContext>,
    ) as unknown as IMessageHandlerResultSetter<unknown>,
  );
  tryAddScopedFactory(services, IBenzeneResponseAdapter, () =>
    new BenzeneMessageResponseAdapter() as unknown as IBenzeneResponseAdapter<unknown>,
  );

  addMediaFormatNegotiation<BenzeneMessageContext>(services);
  tryAddScopedFactory(services, IResponseRenderer, (r) =>
    new SerializerResponseRenderer<BenzeneMessageContext>(
      r.getService(IResponsePayloadMapper) as IResponsePayloadMapper<BenzeneMessageContext>,
      r.getService(IMediaFormatNegotiator) as IMediaFormatNegotiator<BenzeneMessageContext>,
      r,
    ) as unknown as IResponseRenderer<unknown>,
  );
  tryAddScopedFactory(services, IResponseHandler, (r) =>
    new RendererResponseHandler<BenzeneMessageContext>(
      r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<BenzeneMessageContext>,
      r.getServices(IResponseRenderer) as IResponseRenderer<BenzeneMessageContext>[],
      r,
    ) as unknown as IResponseHandler<unknown>,
  );
  // C# uses `AddScoped` (not `TryAdd`) here: DefaultResponseStatusHandler is registered as an
  // ADDITIONAL IResponseHandler alongside RendererResponseHandler, so both run for every response.
  services.addScopedFactory(IResponseHandler, (r) =>
    new DefaultResponseStatusHandler<BenzeneMessageContext>(
      r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<BenzeneMessageContext>,
    ) as unknown as IResponseHandler<unknown>,
  );
  tryAddScopedFactory(services, IResponsePayloadMapper, () =>
    new DefaultResponsePayloadMapper<BenzeneMessageContext>() as unknown as IResponsePayloadMapper<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('direct'));

  return services;
}

/**
 * Registers an `IApplicationInfo` with the given metadata. Port of C# `SetApplicationInfo`.
 */
export function setApplicationInfo(
  services: IBenzeneServiceContainer,
  name: string,
  version: string,
  description: string,
): IBenzeneServiceContainer {
  services.addSingletonFactory(IApplicationInfo, () => new ApplicationInfo(name, version, description));
  return services;
}

/**
 * Registers the baseline services every Benzene application needs regardless of transport: default
 * statuses, transport-info tracking, a blank `IApplicationInfo` (if none is set), version selection,
 * the default JSON `ISerializer`, the service resolver, and core middleware.
 * Port of C# `AddBenzene`.
 */
export function addBenzene(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddSingleton(services, IDefaultStatuses, DefaultStatuses);
  tryAddSingletonFactory(services, ITransportsInfo, (r) => new TransportsInfo(r.getServices(ITransportInfo)));

  tryAddScoped(services, CurrentTransportInfo);
  tryAddScopedFactory(services, ICurrentTransport, (r) => r.getService(CurrentTransportInfo));
  tryAddScopedFactory(services, ISetCurrentTransport, (r) => r.getService(CurrentTransportInfo));

  tryAddSingleton(services, IApplicationInfo, BlankApplicationInfo);
  tryAddSingleton(services, IVersionSelector, VersionSelector);
  tryAddSingleton(services, ISerializer, JsonSerializer);
  tryAddSingleton(services, JsonSerializer);
  services.addServiceResolver();
  addBenzeneMiddleware(services);
  return services;
}

/**
 * Registers the per-context request/response mapping services (message getter, response payload
 * mapper, response handler container, media-format negotiation, and the negotiator-driven request
 * mapper). Port of C# `AddContextItems`.
 *
 * Wrinkle 1 (open generic → factory): each C# `TryAddScoped(typeof(IFace<>), typeof(Impl<>))`
 * becomes a `tryAddScopedFactory` under the shared token that constructs the concrete `Impl` with
 * its constructor dependencies resolved from the container (the erased `<TContext>` is closed to the
 * single context type the app uses). `JsonMediaFormat`/`IMediaFormatNegotiator` are registered here
 * with the same factories `addMediaFormatNegotiation` uses (C# likewise inlines both TryAdds rather
 * than calling `AddMediaFormatNegotiation`), so a context wired only via `addMessageHandlers` still
 * gets a negotiator.
 */
export function addContextItems(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScopedFactory(services, IMessageGetter, (r) =>
    new MessageGetter(
      r.getService(IMessageTopicGetter),
      r.getService(IMessageBodyGetter),
      r.getService(IMessageHeadersGetter),
    ),
  );
  tryAddScopedFactory(services, IResponsePayloadMapper, () => new DefaultResponsePayloadMapper());
  tryAddScopedFactory(services, IResponseHandlerContainer, (r) =>
    new ResponseHandlerContainer(r.getService(IBenzeneResponseAdapter), r.getServices(IResponseHandler)),
  );
  tryAddScopedFactory(services, JsonMediaFormat, (r) => new JsonMediaFormat(r.getService(JsonSerializer)));
  tryAddScopedFactory(services, IMediaFormatNegotiator, (r) =>
    new MediaFormatNegotiator(
      r.getServices(IMediaFormat),
      r.getService(JsonMediaFormat),
      r,
    ) as unknown as IMediaFormatNegotiator<unknown>,
  );
  tryAddScopedFactory(services, IRequestMapper, (r) =>
    new MultiSerializerOptionsRequestMapper(
      r.getService(IMediaFormatNegotiator),
      r,
      r.getService(IMessageBodyGetter),
      r.getServices(IRequestEnricher),
    ) as unknown as IRequestMapper<unknown>,
  );
  return services;
}

/**
 * Registers message-handler dispatch infrastructure. With handler classes supplied, discovery is
 * limited to those classes (via a cached `RegistryMessageHandlersFinder`, the port of the C#
 * `Type[]` overload) and each discovered handler is eagerly registered scoped; with none supplied,
 * discovery falls back to the global `MessageHandlersRegistry`.
 * Port of C# `AddMessageHandlers` (the `()`/`Type[]` overloads unified).
 *
 * Wrinkle 3 (discovery: reflection → registry): C#'s no-arg overload registers no reflection finder;
 * its `Type[]` overload wraps a `ReflectionMessageHandlersFinder` in a cache. In the port the
 * decorator-driven `RegistryMessageHandlersFinder` IS the discovery mechanism, so the no-arg overload
 * uses the global registry (the natural equivalent of assembly scanning — every `@message`-decorated
 * class that has been imported), and both overloads eagerly register each discovered handler class as
 * scoped so `MessageHandlerFactory` can resolve it. The composite finder is
 * `Composite(registry-cache, MessageHandlersList, DependencyMessageHandlersFinder)`, matching the C#
 * `Type[]` overload's `Composite(cache, list, dependency)`.
 *
 * Wrinkle 2 (`MessageRouter<TContext>`): C# `TryAddScoped(typeof(MessageRouter<>))` becomes a factory
 * resolving the 7 constructor dependencies in the ported ctor order verified against `MessageRouter.ts`
 * — (factory, messageGetter, definitionLookUp, requestMapper, resultSetter, defaultStatuses, logger).
 * The `ILogger<MessageRouter<TContext>>` maps to a logger obtained from an optional `ILoggerFactory`,
 * falling back to `NullLogger.instance`.
 */
export function addMessageHandlers(
  services: IBenzeneServiceContainer,
  ...handlerTypes: Constructor<unknown>[]
): IBenzeneServiceContainer {
  const registryFinder =
    handlerTypes.length > 0
      ? new RegistryMessageHandlersFinder(...handlerTypes)
      : new RegistryMessageHandlersFinder();
  const cacheMessageHandlersFinder = new CacheMessageHandlersFinder(registryFinder);
  for (const handler of cacheMessageHandlersFinder.findDefinitions()) {
    services.addScoped(handler.handlerType);
  }

  tryAddSingletonFactory(services, MessageHandlersList, () => new MessageHandlersList());
  tryAddSingletonFactory(
    services,
    DependencyMessageHandlersFinder,
    (r) => new DependencyMessageHandlersFinder(r.getServices(IMessageHandlerDefinition)),
  );
  tryAddSingletonFactory(services, IMessageHandlersList, (r) => r.getService(MessageHandlersList));
  tryAddSingletonFactory(
    services,
    IMessageHandlersFinder,
    (r) =>
      new CompositeMessageHandlersFinder(
        cacheMessageHandlersFinder,
        r.getService(MessageHandlersList),
        r.getService(DependencyMessageHandlersFinder),
      ),
  );
  tryAddSingletonFactory(
    services,
    MessageHandlerDefinitionIndex,
    (r) =>
      new MessageHandlerDefinitionIndex(
        r.getServices(IMessageHandlersFinder),
        r.getService(MessageHandlersList),
      ),
  );

  tryAddScopedFactory(
    services,
    IMessageHandlerDefinitionLookUp,
    (r) =>
      new MessageHandlerDefinitionLookUp(
        r.getService(MessageHandlerDefinitionIndex),
        r.getService(IVersionSelector),
      ),
  );
  tryAddScopedFactory(
    services,
    IHandlerPipelineBuilder,
    (r) => new HandlerPipelineBuilder(r.getServices(IHandlerMiddlewareBuilder)),
  );
  tryAddScopedFactory(
    services,
    IMessageHandlerWrapper,
    (r) => new PipelineMessageHandlerWrapper(r.getService(IHandlerPipelineBuilder), r),
  );
  tryAddScopedFactory(
    services,
    IMessageHandlerFactory,
    (r) =>
      new MessageHandlerFactory(
        r,
        r.getService(IMessageHandlerWrapper),
        r.tryGetService(ILoggerFactory) ?? NullLoggerFactory.instance,
        r.getService(IDefaultStatuses),
      ),
  );
  tryAddScopedFactory(
    services,
    MessageRouter as ServiceIdentifier<MessageRouter<unknown>>,
    (r) =>
      new MessageRouter(
        r.getService(IMessageHandlerFactory),
        r.getService(IMessageGetter),
        r.getService(IMessageHandlerDefinitionLookUp),
        r.getService(IRequestMapper),
        r.getService(IMessageHandlerResultSetter),
        r.getService(IDefaultStatuses),
        r.tryGetService(ILoggerFactory)?.createLogger('Benzene') ?? NullLogger.instance,
      ),
  );

  addContextItems(services);
  return services;
}
