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
import { ApiGatewayContext } from './ApiGatewayContext';
import { ApiGatewayHttpRequestAdapter } from './ApiGatewayHttpRequestAdapter';
import { ApiGatewayMessageBodyGetter } from './ApiGatewayMessageBodyGetter';
import { ApiGatewayMessageHeadersGetter } from './ApiGatewayMessageHeadersGetter';
import { ApiGatewayMessageMessageHandlerResultSetter } from './ApiGatewayMessageMessageHandlerResultSetter';
import { ApiGatewayMessageTopicGetter } from './ApiGatewayMessageTopicGetter';
import { ApiGatewayRequestEnricher } from './ApiGatewayRequestEnricher';
import { ApiGatewayResponseAdapter } from './ApiGatewayResponseAdapter';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.DependencyInjectionExtensions.AddApiGateway (C# extension
 * method -> free function). Called automatically by `useApiGateway`.
 *
 * Registers everything needed to process an API Gateway HTTP request: the boundary getters
 * (topic via routing, headers, body), the request mapper + enricher, the HTTP request adapter, the
 * response adapter, the HTTP response-handler chain (status code + body renderer), media-format
 * negotiation, an `"api-gateway"` `ITransportInfo`, and the HTTP routing infrastructure
 * (`addHttpMessageHandlers`).
 *
 * DI-under-erasure notes (same pattern as `addSqs`/`addBenzeneMessage`): each C# closed-generic
 * registration `AddScoped<IFace<ApiGatewayContext>, Impl>` becomes a factory registration under the
 * interface's shared `<unknown>` token (the app uses one context type per pipeline, closing the
 * erased `<ApiGatewayContext>`). Where C# uses `TryAddScoped` the port uses `tryAddScopedFactory`;
 * where it uses `AddScoped` the port uses the non-`try` `addScopedFactory`. The getters + result
 * setter are `TryAdd`; the mapper/enricher/adapters/response-handlers are non-`try` (so they layer
 * onto / win over the generic `addContextItems` defaults registered later by `useMessageHandlers`).
 * The two `IResponseHandler` registrations (status then renderer) are additive: `getServices`
 * returns both, run in order by `ResponseHandlerContainer`.
 *
 * Response-status deviation from the `BenzeneMessage` transport: instead of `DefaultResponseStatusHandler`
 * (which copies the raw status string), the HTTP transport registers `HttpStatusCodeResponseHandler`
 * + `DefaultHttpStatusCodeMapper` (via `addHttpMessageHandlers`) so `"Ok"` becomes `"200"` etc.
 */
export function addApiGateway(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  tryAddScopedFactory(
    services,
    IMessageTopicGetter,
    (r) =>
      new ApiGatewayMessageTopicGetter(r.getService(IRouteFinder)) as IMessageTopicGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageHeadersGetter,
    (r) =>
      new ApiGatewayMessageHeadersGetter(
        r.getService(IHttpHeaderMappings),
      ) as IMessageHeadersGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageBodyGetter,
    () => new ApiGatewayMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageHandlerResultSetter,
    (r) =>
      new ApiGatewayMessageMessageHandlerResultSetter(
        r.getService(IResponseHandlerContainer) as IResponseHandlerContainer<ApiGatewayContext>,
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
      new ApiGatewayRequestEnricher(
        r.getService(IRouteFinder),
        r.getService(IHttpHeaderMappings),
      ) as IRequestEnricher<unknown>,
  );
  services.addScopedFactory(
    IHttpRequestAdapter,
    () => new ApiGatewayHttpRequestAdapter() as unknown as IHttpRequestAdapter<IHttpContext>,
  );
  services.addScopedFactory(
    IBenzeneResponseAdapter,
    () => new ApiGatewayResponseAdapter() as IBenzeneResponseAdapter<unknown>,
  );

  tryAddScopedFactory(services, IHttpHeaderMappings, () => new DefaultHttpHeaderMappings());

  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new HttpStatusCodeResponseHandler<ApiGatewayContext>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<ApiGatewayContext>,
        r.getService(IHttpStatusCodeMapper),
      ) as IResponseHandler<unknown>,
  );
  services.addScopedFactory(
    IResponseRenderer,
    (r) =>
      new SerializerResponseRenderer<ApiGatewayContext>(
        r.getService(IResponsePayloadMapper) as IResponsePayloadMapper<ApiGatewayContext>,
        r.getService(IMediaFormatNegotiator) as IMediaFormatNegotiator<ApiGatewayContext>,
        r,
      ) as IResponseRenderer<unknown>,
  );
  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new RendererResponseHandler<ApiGatewayContext>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<ApiGatewayContext>,
        r.getServices(IResponseRenderer) as IResponseRenderer<ApiGatewayContext>[],
        r,
      ) as IResponseHandler<unknown>,
  );

  addMediaFormatNegotiation<ApiGatewayContext>(services);

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('api-gateway'));
  addHttpMessageHandlers(services);

  return services;
}
