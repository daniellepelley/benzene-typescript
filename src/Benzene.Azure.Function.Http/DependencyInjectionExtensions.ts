import { IBenzeneServiceContainer } from '@benzene/abstractions';
import {
  IBenzeneResponseAdapter,
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IResponseHandler,
  IResponseHandlerContainer,
  IResponsePayloadMapper,
  IResponseRenderer,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import {
  addMediaFormatNegotiation,
  RendererResponseHandler,
  SerializerResponseRenderer,
} from '@benzene/core-message-handlers';
import {
  addHttpMessageHandlers,
  HttpStatusCodeResponseHandler,
  IHttpContext,
  IHttpRequestAdapter,
  IHttpStatusCodeMapper,
  IRouteFinder,
} from '@benzene/http';
import { IAzureFunctionAppBuilder } from '@benzene/azure-function-core';
import { AzureHttpApplication } from './AzureHttpApplication';
import { AzureHttpContext } from './AzureHttpContext';
import { AzureHttpContextRequestEnricher } from './AzureHttpContextRequestEnricher';
import { AzureHttpMessageBodyGetter } from './AzureHttpMessageBodyGetter';
import { AzureHttpMessageHeadersGetter } from './AzureHttpMessageHeadersGetter';
import { AzureHttpMessageMessageHandlerResultSetter } from './AzureHttpMessageMessageHandlerResultSetter';
import { AzureHttpMessageTopicGetter } from './AzureHttpMessageTopicGetter';
import { AzureHttpRequestAdapter } from './AzureHttpRequestAdapter';
import { AzureHttpResponseAdapter } from './AzureHttpResponseAdapter';

/**
 * Port of Benzene.Azure.Function.AspNet.DependencyInjectionExtensions.AddAspNet (C# extension method
 * -> free function). Renamed `addAzureHttp` to match the package's `@benzene/azure-function-http`
 * surface (the ASP.NET -> `@azure/functions` HTTP retarget documented on `AzureHttpContext`). Called
 * automatically by `useAzureHttp`.
 *
 * Registers everything needed to process an HTTP request: the boundary getters (topic via routing,
 * headers, body), the result setter, the HTTP request adapter, the response adapter, the HTTP
 * response-handler chain (body renderer + status code), media-format negotiation, the request
 * enricher, and the HTTP routing infrastructure (`addHttpMessageHandlers`).
 *
 * FAITHFULNESS TO C# `AddAspNet`: like the C# original, this does NOT register `IRequestMapper`,
 * `JsonSerializer`, or an `ITransportInfo` — the request mapper comes from the generic
 * `addContextItems` defaults registered by `useMessageHandlers` (which reads this package's
 * `IRequestEnricher`), `JsonSerializer` from `addBenzene`, and nothing in the request/response path
 * requires a transport info. All registrations use non-`try` `addScopedFactory`, mirroring C#'s
 * `AddScoped` (so these HTTP components win over any generic defaults), except the two additive
 * `IResponseHandler` registrations which `getServices` returns together, run in order by
 * `ResponseHandlerContainer`.
 *
 * DI-under-erasure notes (same pattern as `addApiGateway`/`addServiceBus`): each C# closed-generic
 * `AddScoped<IFace<AspNetContext>, Impl>` becomes a factory registration under the interface's shared
 * `<unknown>` token (one context type per pipeline closes the erased `<AzureHttpContext>`).
 *
 * Response-status deviation from the `BenzeneMessage` transport: instead of `DefaultResponseStatusHandler`
 * (which copies the raw status string), the HTTP transport registers `HttpStatusCodeResponseHandler` +
 * `DefaultHttpStatusCodeMapper` (via `addHttpMessageHandlers`) so `"Ok"` becomes `"200"` etc.
 */
export function addAzureHttp(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  services.addScopedFactory(
    IMessageTopicGetter,
    (r) =>
      new AzureHttpMessageTopicGetter(r.getService(IRouteFinder)) as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new AzureHttpMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new AzureHttpMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    (r) =>
      new AzureHttpMessageMessageHandlerResultSetter(
        r.getService(IResponseHandlerContainer) as IResponseHandlerContainer<AzureHttpContext>,
      ) as IMessageHandlerResultSetter<unknown>,
  );
  services.addScopedFactory(
    IHttpRequestAdapter,
    () => new AzureHttpRequestAdapter() as unknown as IHttpRequestAdapter<IHttpContext>,
  );
  services.addScopedFactory(
    IBenzeneResponseAdapter,
    () => new AzureHttpResponseAdapter() as IBenzeneResponseAdapter<unknown>,
  );

  services.addScopedFactory(
    IResponseRenderer,
    (r) =>
      new SerializerResponseRenderer<AzureHttpContext>(
        r.getService(IResponsePayloadMapper) as IResponsePayloadMapper<AzureHttpContext>,
        r.getService(IMediaFormatNegotiator) as IMediaFormatNegotiator<AzureHttpContext>,
        r,
      ) as IResponseRenderer<unknown>,
  );
  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new RendererResponseHandler<AzureHttpContext>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<AzureHttpContext>,
        r.getServices(IResponseRenderer) as IResponseRenderer<AzureHttpContext>[],
        r,
      ) as IResponseHandler<unknown>,
  );
  services.addScopedFactory(
    IResponseHandler,
    (r) =>
      new HttpStatusCodeResponseHandler<AzureHttpContext>(
        r.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<AzureHttpContext>,
        r.getService(IHttpStatusCodeMapper),
      ) as IResponseHandler<unknown>,
  );

  addMediaFormatNegotiation<AzureHttpContext>(services);

  services.addScopedFactory(
    IRequestEnricher,
    (r) => new AzureHttpContextRequestEnricher(r.getService(IRouteFinder)) as IRequestEnricher<unknown>,
  );
  addHttpMessageHandlers(services);

  return services;
}

/**
 * Adds an HTTP entry-point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseHttp(this IAzureFunctionAppBuilder,
 * ...)` (renamed `useAzureHttp` to match this package's surface, mirroring the AWS `useApiGateway` and
 * Azure `useServiceBus` layout). Registers the HTTP services, builds the per-request
 * `AzureHttpContext` pipeline from `action`, then adds an `AzureHttpApplication` over it.
 *
 * DEFERRED: the C# `UseHttp(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not ported
 * — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the same
 * treatment given to the deferred Azure/AWS generic-host bootstrap).
 *
 * @param app The Azure Function app builder to add HTTP handling to.
 * @param action Configures the HTTP middleware pipeline.
 */
export function useAzureHttp(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<AzureHttpContext>,
): IAzureFunctionAppBuilder {
  app.register((x) => addAzureHttp(x));
  const pipeline = app.create<AzureHttpContext>();
  action(pipeline);
  app.add(
    (serviceResolverFactory) => new AzureHttpApplication(pipeline.build(), serviceResolverFactory),
  );
  return app;
}
