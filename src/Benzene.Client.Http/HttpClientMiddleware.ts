import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { HttpRequestMessage, HttpSendMessageContext } from './HttpSendMessageContext';

/**
 * A `fetch`-like function: takes the built request and returns the response.
 * Port of the role played by .NET `HttpClient.SendAsync`.
 */
export type FetchLike = (request: HttpRequestMessage) => Promise<Response>;

/**
 * The default `fetch` adapter over the Node global `fetch`, translating the transport-agnostic
 * `HttpRequestMessage` shape into the `fetch(url, init)` call.
 */
export const defaultFetch: FetchLike = (request) =>
  fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

/**
 * The terminal middleware that actually performs the HTTP call: it sends the context's request and
 * stores the response on the context.
 * Port of Benzene.Client.Http.HttpClientMiddleware.
 *
 * HttpClient -> fetch adaptation. .NET injects an `HttpClient` and calls `SendAsync`. The port injects
 * a `fetch`-like function instead — defaulting to the Node global `fetch` (via {@link defaultFetch}),
 * but accepting an injected one so tests can stub the transport. Like the C# middleware this is a
 * terminal step and does not call `next`.
 */
export class HttpClientMiddleware implements IMiddleware<HttpSendMessageContext> {
  private readonly fetchFn: FetchLike;

  constructor(fetchFn: FetchLike = defaultFetch) {
    this.fetchFn = fetchFn;
  }

  readonly name = 'HttpClientMiddleware';

  async handleAsync(context: HttpSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.fetchFn(context.request);
  }
}
