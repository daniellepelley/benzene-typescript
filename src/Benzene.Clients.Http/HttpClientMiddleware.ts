import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { HttpRequestMessage, HttpSendMessageContext } from './HttpSendMessageContext';

/**
 * A `fetch`-like function: takes the built request (and the caller's abort signal, when one is set on
 * the send context) and returns the response.
 * Port of the role played by .NET `HttpClient.SendAsync` (whose `CancellationToken` parameter maps to
 * the optional `AbortSignal`).
 */
export type FetchLike = (request: HttpRequestMessage, signal?: AbortSignal) => Promise<Response>;

/**
 * The default `fetch` adapter over the Node global `fetch`, translating the transport-agnostic
 * `HttpRequestMessage` shape into the `fetch(url, init)` call. The caller's abort signal (if any) is
 * forwarded as `init.signal`, so aborting it aborts the in-flight HTTP call.
 */
export const defaultFetch: FetchLike = (request, signal) =>
  fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal,
  });

/**
 * The terminal middleware that actually performs the HTTP call: it sends the context's request and
 * stores the response on the context.
 * Port of Benzene.Client.Http.HttpClientMiddleware.
 *
 * HttpClient -> fetch adaptation. .NET injects an `HttpClient` and calls `SendAsync`. The port injects
 * a `fetch`-like function instead — defaulting to the Node global `fetch` (via {@link defaultFetch}),
 * but accepting an injected one so tests can stub the transport. Like the C# middleware this is a
 * terminal step and does not call `next`. The context's {@link HttpSendMessageContext.signal} is
 * passed through to the fetch function, so an aborted caller aborts the outbound call.
 */
export class HttpClientMiddleware implements IMiddleware<HttpSendMessageContext> {
  private readonly fetchFn: FetchLike;

  constructor(fetchFn: FetchLike = defaultFetch) {
    this.fetchFn = fetchFn;
  }

  readonly name = 'HttpClientMiddleware';

  async handleAsync(context: HttpSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.fetchFn(context.request, context.signal);
  }
}
