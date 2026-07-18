import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { IAzureFunctionApp } from '@benzene/azure-function-core';
import { AzureHttpRequestEvent } from './AzureHttpApplication';

/**
 * Port of Benzene.Azure.Function.AspNet.Extensions (C# fluent extension methods -> free functions
 * taking the source as the first argument).
 *
 * Dispatches an HTTP-trigger request to the Azure Function app's HTTP entry-point application. Port of
 * C# `Extensions.HandleHttpRequest(this IAzureFunctionApp source, HttpRequest httpRequest)`, which
 * calls `source.HandleAsync<HttpRequest, IActionResult>(httpRequest)`.
 *
 * ASYNC-BODY HANDLING: this is the "Azure entry point" the field notes describe — the natural place to
 * materialize the body. `@azure/functions`' `HttpRequest.text()` is asynchronous and can only be read
 * once, so the body is read here, up front, and carried alongside the request in an
 * `AzureHttpRequestEvent`; the downstream context/getter chain is then fully synchronous (keeping
 * `IMessageBodyGetter.getBody` synchronous, as in the .NET port). The `IActionResult` result maps to
 * `@azure/functions`' `HttpResponseInit`, dispatched via the `WithResult` entry-point path
 * (`handleAsyncWithResult`).
 *
 * @param source The built Azure Function app to dispatch to.
 * @param httpRequest The incoming `@azure/functions` HTTP request.
 * @returns The `HttpResponseInit` to return from the HTTP-trigger function.
 */
export async function handleHttpRequest(
  source: IAzureFunctionApp,
  httpRequest: HttpRequest,
): Promise<HttpResponseInit> {
  const body = await httpRequest.text();
  return source.handleAsyncWithResult<AzureHttpRequestEvent, HttpResponseInit>({
    request: httpRequest,
    body,
  });
}

/**
 * Ensures the context's response and its headers are initialized. Port of C#
 * `Extensions.EnsureResponseExists`. Re-exported from its leaf module `AzureHttpContext` (where it is
 * defined to avoid an import cycle) so the public API location still matches C#.
 */
export { ensureResponseExists } from './AzureHttpContext';
