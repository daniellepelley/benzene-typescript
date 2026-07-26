import { IBenzeneServiceContainer, tryAddScoped, tryAddScopedFactory } from '@benzene/abstractions';
import {
  IBenzeneResponseAdapter,
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  IResponseHandler,
  IResponseHandlerContainer,
  IResponsePayloadMapper,
  IResponseRenderer,
  ITransportInfo,
  TransportNames,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import {
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  RendererResponseHandler,
  SerializerResponseRenderer,
  TransportInfo,
} from '@benzene/core-message-handlers';
import {
  addHttpMessageHandlers,
  DefaultHttpHeaderMappings,
  HttpStatusCodeResponseHandler,
  IHttpContext,
  IHttpHeaderMappings,
  IHttpRequestAdapter,
  IHttpStatusCodeMapper,
  IRouteFinder,
} from '@benzene/http';
import { ExpressContext } from './ExpressContext';
import { ExpressHttpRequestAdapter } from './ExpressHttpRequestAdapter';
import { ExpressMessageBodyGetter } from './ExpressMessageBodyGetter';
import { ExpressMessageHeadersGetter } from './ExpressMessageHeadersGetter';
import { ExpressMessageMessageHandlerResultSetter } from './ExpressMessageMessageHandlerResultSetter';
import { ExpressMessageTopicGetter } from './ExpressMessageTopicGetter';
import { ExpressRequestEnricher } from './ExpressRequestEnricher';
import { ExpressResponseAdapter } from './ExpressResponseAdapter';

/**
 * Registers everything needed to process an Express HTTP request: the boundary getters (topic via routing,
 * headers, body), the request mapper + enricher, the HTTP request adapter, the response adapter, the HTTP
 * response-handler chain (status code + body renderer), media-format negotiation, an `"express"`
 * `ITransportInfo`, and the HTTP routing infrastructure (`addHttpMessageHandlers`).
 *
 * Direct structural analog of `addApiGateway` (see its notes on the DI-under-erasure factory pattern);
 * only the concrete adapter classes and the transport name differ. Called automatically by `benzene()`.
 */
export function addExpress(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  tryAddScopedFactory(
    services,
    IMessageTopicGetter,
    (r) => new ExpressMessageTopicGetter(r.getService(IRouteFinder)) as IMessageTopicGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageHeadersGetter,
    (r) => new ExpressMessageHeadersGetter(r.getService(IHttpHeaderMappings)) as IMessageHeadersGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageBodyGetter,
    () => new ExpressMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageHandlerResultSetter,
    (r) =>
      new ExpressMessageMessageHandlerResultSetter(
        r.getService(IResponseHandlerContainer) as IResponseHandlerContainer<ExpressContext>,
      ) as IMessageHandlerResultSetter<unknown>,
  );

  services.addScopedFactory(
    IRequestMapper,
    (r) =>
      new MultiSerializerOptionsRequestMapper(
        r.getService(IMediaFormatNegotiator),
        r,
        r.getService(IMessageBodyGetter),
        r.getServices(IRequestEnricher),
      ) as IRequestMapper<unknown>,
  );
  services.addScopedFactory(
    IRequestEnricher,
    (r) =>
      new ExpressRequestEnricher(
        r.getService(IRouteFinder),
        r.getService(IHttpHeaderMappings),
      ) as IRequestEnricher<unknown>,
  );
  services.addScopedFactory(
    IHttpRequestAdapter,
    () => new ExpressHttpRequestAdapter() as unknown as IHttpRequestAdapter<IHttpContext>,
  );
  services.addScopedFactory(
    IBenzeneResponseAdapter,
    () => new ExpressResponseAdapter() as IBenzeneResponseAdapter<unknown>,
  );

  tryAddScopedFactory(services, IHttpHeaderMappings, () => new DefaultHttpHeaderMappings());

  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new HttpStatusCodeResponseHandler<ExpressContext>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<ExpressContext>,
        r.getService(IHttpStatusCodeMapper),
      ) as IResponseHandler<unknown>,
  );
  services.addScopedFactory(
    IResponseRenderer,
    (r) =>
      new SerializerResponseRenderer<ExpressContext>(
        r.getService(IResponsePayloadMapper) as IResponsePayloadMapper<ExpressContext>,
        r.getService(IMediaFormatNegotiator) as IMediaFormatNegotiator<ExpressContext>,
        r,
      ) as IResponseRenderer<unknown>,
  );
  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new RendererResponseHandler<ExpressContext>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<ExpressContext>,
        r.getServices(IResponseRenderer) as IResponseRenderer<ExpressContext>[],
        r,
      ) as IResponseHandler<unknown>,
  );

  addMediaFormatNegotiation<ExpressContext>(services);

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.Express));
  addHttpMessageHandlers(services);

  return services;
}
