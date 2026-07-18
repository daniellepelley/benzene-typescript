import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import {
  EntryPointMiddlewareApplicationWithResult,
  MiddlewareApplicationWithResult,
} from '@benzene/core-middleware';
import { AzureHttpContext, ensureResponseExists } from './AzureHttpContext';

/**
 * The entry-point event for the HTTP application: an `@azure/functions` `HttpRequest` paired with its
 * eagerly-read `body`.
 *
 * WHY A PAIR (not just `HttpRequest`): C#'s `AspNetApplication` is
 * `EntryPointMiddlewareApplication<HttpRequest, IActionResult>` whose event is the ASP.NET
 * `HttpRequest`, mapped to a context synchronously (`event => new AspNetContext(event)`), reading the
 * body inside the context via a blocking stream read. `@azure/functions`' body accessors are
 * asynchronous and the ported `MiddlewareApplicationWithResult` mapper is synchronous, so the body is
 * read once, up front, at the entry point (`handleHttpRequest` `await request.text()`) and carried
 * alongside the request here. The synchronous mapper then closes over both to build the context.
 */
export interface AzureHttpRequestEvent {
  /** The incoming `@azure/functions` HTTP request. */
  request: HttpRequest;
  /** The request body, read eagerly (`await request.text()`) before the synchronous pipeline runs. */
  body: string | undefined;
}

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetApplication.
 *
 * The entry-point application for an HTTP-triggered Azure Function. Wraps the incoming request in an
 * `AzureHttpContext`, runs it through the middleware pipeline, and returns the resulting
 * `HttpResponseInit`.
 *
 * ARITY: C#'s `AspNetApplication : EntryPointMiddlewareApplication<HttpRequest, IActionResult>` wraps a
 * `MiddlewareApplication<HttpRequest, AspNetContext, IActionResult>` (the arity-3, result-returning
 * variant). Per the port's `WithResult` naming rule that becomes
 * `EntryPointMiddlewareApplicationWithResult<AzureHttpRequestEvent, HttpResponseInit>` over a
 * `MiddlewareApplicationWithResult<AzureHttpRequestEvent, AzureHttpContext, HttpResponseInit>`.
 * `IActionResult` (the ASP.NET result) maps to `@azure/functions`' `HttpResponseInit`.
 *
 * The result mapper returns `context.response`, populated by the response handlers via
 * `ensureResponseExists`; it is ensured non-`undefined` here for a request that reached the pipeline.
 */
export class AzureHttpApplication extends EntryPointMiddlewareApplicationWithResult<
  AzureHttpRequestEvent,
  HttpResponseInit
> {
  constructor(
    pipeline: IMiddlewarePipeline<AzureHttpContext>,
    serviceResolverFactory: IServiceResolverFactory,
  ) {
    super(
      new MiddlewareApplicationWithResult<AzureHttpRequestEvent, AzureHttpContext, HttpResponseInit>(
        pipeline,
        (event) => new AzureHttpContext(event.request, event.body),
        (context) => {
          ensureResponseExists(context);
          return context.response!;
        },
      ),
      serviceResolverFactory,
    );
  }
}
