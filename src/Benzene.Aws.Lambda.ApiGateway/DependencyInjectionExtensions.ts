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
import { ApiGatewayContext } from './ApiGatewayContext';
import { ApiGatewayHttpRequestAdapter } from './ApiGatewayHttpRequestAdapter';
import { ApiGatewayMessageBodyGetter } from './ApiGatewayMessageBodyGetter';
import { ApiGatewayMessageHeadersGetter } from './ApiGatewayMessageHeadersGetter';
import { ApiGatewayMessageMessageHandlerResultSetter } from './ApiGatewayMessageMessageHandlerResultSetter';
import { ApiGatewayMessageTopicGetter } from './ApiGatewayMessageTopicGetter';
import { ApiGatewayRequestEnricher } from './ApiGatewayRequestEnricher';
import { ApiGatewayResponseAdapter } from './ApiGatewayResponseAdapter';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';
import { ApiGatewayV2HttpRequestAdapter } from './ApiGatewayV2HttpRequestAdapter';
import { ApiGatewayV2MessageBodyGetter } from './ApiGatewayV2MessageBodyGetter';
import { ApiGatewayV2MessageHeadersGetter } from './ApiGatewayV2MessageHeadersGetter';
import { ApiGatewayV2MessageMessageHandlerResultSetter } from './ApiGatewayV2MessageMessageHandlerResultSetter';
import { ApiGatewayV2MessageTopicGetter } from './ApiGatewayV2MessageTopicGetter';
import { ApiGatewayV2RequestEnricher } from './ApiGatewayV2RequestEnricher';
import { ApiGatewayV2ResponseAdapter } from './ApiGatewayV2ResponseAdapter';

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.ApiGateway));
  addHttpMessageHandlers(services);

  return services;
}

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.DependencyInjectionExtensions.AddApiGatewayV2 (C# extension
 * method -> free function). Called automatically by `useApiGatewayV2`.
 *
 * The v2 (HTTP API, payload format 2.0) counterpart of {@link addApiGateway}: identical wiring with the
 * `ApiGatewayV2*` getters/adapters/enricher/result-setter swapped in (method/path from
 * `requestContext.http`, cookies folded into headers, base64 body decode, the structured v2 response).
 * The same DI-under-erasure pattern applies — each closed-generic `<ApiGatewayV2Context>` registration
 * becomes a factory under the interface's shared `<unknown>` token.
 */
export function addApiGatewayV2(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  tryAddScopedFactory(
    services,
    IMessageTopicGetter,
    (r) =>
      new ApiGatewayV2MessageTopicGetter(r.getService(IRouteFinder)) as IMessageTopicGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageHeadersGetter,
    (r) =>
      new ApiGatewayV2MessageHeadersGetter(
        r.getService(IHttpHeaderMappings),
      ) as IMessageHeadersGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageBodyGetter,
    () => new ApiGatewayV2MessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageHandlerResultSetter,
    (r) =>
      new ApiGatewayV2MessageMessageHandlerResultSetter(
        r.getService(IResponseHandlerContainer) as IResponseHandlerContainer<ApiGatewayV2Context>,
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
      new ApiGatewayV2RequestEnricher(
        r.getService(IRouteFinder),
        r.getService(IHttpHeaderMappings),
      ) as IRequestEnricher<unknown>,
  );
  services.addScopedFactory(
    IHttpRequestAdapter,
    () => new ApiGatewayV2HttpRequestAdapter() as unknown as IHttpRequestAdapter<IHttpContext>,
  );
  services.addScopedFactory(
    IBenzeneResponseAdapter,
    () => new ApiGatewayV2ResponseAdapter() as IBenzeneResponseAdapter<unknown>,
  );

  tryAddScopedFactory(services, IHttpHeaderMappings, () => new DefaultHttpHeaderMappings());

  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new HttpStatusCodeResponseHandler<ApiGatewayV2Context>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<ApiGatewayV2Context>,
        r.getService(IHttpStatusCodeMapper),
      ) as IResponseHandler<unknown>,
  );
  services.addScopedFactory(
    IResponseRenderer,
    (r) =>
      new SerializerResponseRenderer<ApiGatewayV2Context>(
        r.getService(IResponsePayloadMapper) as IResponsePayloadMapper<ApiGatewayV2Context>,
        r.getService(IMediaFormatNegotiator) as IMediaFormatNegotiator<ApiGatewayV2Context>,
        r,
      ) as IResponseRenderer<unknown>,
  );
  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new RendererResponseHandler<ApiGatewayV2Context>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<ApiGatewayV2Context>,
        r.getServices(IResponseRenderer) as IResponseRenderer<ApiGatewayV2Context>[],
        r,
      ) as IResponseHandler<unknown>,
  );

  addMediaFormatNegotiation<ApiGatewayV2Context>(services);

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.ApiGateway));
  addHttpMessageHandlers(services);

  return services;
}
