import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { FetchLike, HttpClientMiddleware } from './HttpClientMiddleware';
import { HttpContextConverter } from './HttpContextConverter';
import { HttpSendMessageContext } from './HttpSendMessageContext';

/**
 * Pipeline-builder helpers for wiring the outbound HTTP client.
 * Port of Benzene.Client.Http.Extensions (C# extension methods -> free functions).
 *
 * HttpClient -> fetch adaptation. The C# `UseHttpClient` overloads either take an `HttpClient` or
 * resolve one from DI (`AddScoped<HttpClientMiddleware>()` + `Use<HttpClientMiddleware>()`). Node has
 * no `HttpClient`, so the port collapses both into `useHttpClient(app, fetchFn?)`: it adds the
 * terminal `HttpClientMiddleware`, defaulting to the global `fetch` when no `fetchFn` is injected.
 *
 * The C# `Convert` overloads are already provided by `MiddlewarePipelineBuilderBase.convert`, so they
 * are not re-declared here; the `UseHttp` verb+path helpers map to `useHttpClientToSend` /
 * `useHttp` below.
 */

/**
 * Adds the terminal HTTP-call middleware to an HTTP-shaped pipeline.
 * Port of both C# `UseHttpClient` overloads.
 */
export function useHttpClient(
  app: IMiddlewarePipelineBuilder<HttpSendMessageContext>,
  fetchFn?: FetchLike,
): IMiddlewarePipelineBuilder<HttpSendMessageContext> {
  return app.use(() => new HttpClientMiddleware(fetchFn));
}

/**
 * Converts a client (message-shaped) pipeline into an HTTP send for the given verb+path, running the
 * default terminal HTTP-client middleware inside.
 * Port of C# `UseHttp<TRequest, TResponse>(verb, path)` — i.e.
 * `Convert(new HttpContextConverter(verb, path), b => b.UseHttpClient())`. `fetchFn` is optional and
 * forwarded to the inner `useHttpClient`, letting tests inject a stubbed transport.
 */
export function useHttpClientToSend<TRequest, TResponse>(
  app: IMiddlewarePipelineBuilder<IBenzeneClientContext<TRequest, TResponse>>,
  verb: string,
  path: string,
  fetchFn?: FetchLike,
): IMiddlewarePipelineBuilder<IBenzeneClientContext<TRequest, TResponse>> {
  return app.convert(new HttpContextConverter<TRequest, TResponse>(verb, path), (builder) =>
    useHttpClient(builder, fetchFn),
  );
}

/**
 * Converts a client (message-shaped) pipeline into an HTTP send for the given verb+path, running a
 * caller-supplied inner HTTP pipeline.
 * Port of C# `UseHttp<TRequest, TResponse>(verb, path, action)`.
 */
export function useHttp<TRequest, TResponse>(
  app: IMiddlewarePipelineBuilder<IBenzeneClientContext<TRequest, TResponse>>,
  verb: string,
  path: string,
  action: PipelineBuilderAction<HttpSendMessageContext>,
): IMiddlewarePipelineBuilder<IBenzeneClientContext<TRequest, TResponse>> {
  return app.convert(new HttpContextConverter<TRequest, TResponse>(verb, path), action);
}
