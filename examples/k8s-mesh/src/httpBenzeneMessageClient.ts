/**
 * A minimal outbound `IBenzeneMessageClient` that POSTs the standard BenzeneMessage envelope
 * (`{ topic, headers, body }`) to a fixed downstream URL and reads back the response envelope
 * (`{ statusCode, headers, body }`) — the TypeScript sibling of .NET's `Benzene.Clients.Http.
 * HttpBenzeneMessageClient` (named in the K8sMesh README as the client this example's chaining uses).
 *
 * `@benzenejs/clients-http` ships today only builds the per-topic REST route helpers
 * (`useHttpClientToSend`/`useHttp`) that `@benzenejs/clients`' `addOutboundRouting` model is built
 * around: one fixed verb+path per topic, request serialized straight as the body. K8sMesh's chaining
 * instead needs ONE endpoint per downstream service (`POST /benzene-message`), addressed by the
 * envelope's topic field — exactly the server-side contract `BenzeneMessageHttpMiddleware`
 * (`@benzenejs/http`) already implements. This class is that middleware's client-side mirror: it reuses
 * `@benzenejs/clients-http`'s `fetch` adapter (`FetchLike`/`defaultFetch`) for the actual call, and
 * layers the envelope (de)serialization the framework doesn't ship yet on top. It lives here, in the
 * example, rather than in `@benzenejs/clients-http`, per this task's instruction not to change framework
 * packages while wiring an example — see the task report for why this is a deliberate, narrowly-scoped
 * addition rather than a framework change.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { IBenzeneMessageClient } from '@benzenejs/clients';
import { defaultFetch, FetchLike } from '@benzenejs/clients-http';
import { BenzeneResult } from '@benzenejs/results';

/** The wire shape `BenzeneMessageHttpMiddleware` reads on the way in. */
interface BenzeneMessageEnvelope {
  topic: string;
  headers: Record<string, string>;
  body: string;
}

/** The wire shape `BenzeneMessageHttpMiddleware` writes on the way out. */
interface BenzeneMessageEnvelopeResponse {
  statusCode: string;
  isSuccessful?: boolean;
  headers?: Record<string, string>;
  body?: string;
}

export class HttpBenzeneMessageClient implements IBenzeneMessageClient {
  constructor(
    private readonly url: string,
    private readonly fetchFn: FetchLike = defaultFetch,
  ) {}

  async sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    const envelope: BenzeneMessageEnvelope = {
      topic: request.topic,
      headers: request.headers,
      body: JSON.stringify(request.message),
    };

    const httpResponse = await this.fetchFn({
      url: this.url,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    // The envelope endpoint answers 200 for every envelope it processed (transport-bindings §1), so the
    // outcome is read from the envelope whatever the HTTP status; only a body that is not an envelope (a
    // carrier failure) falls back to the status line.
    const text = await httpResponse.text();
    const response = tryParseEnvelope(text);
    if (response === undefined) {
      return BenzeneResult.set<TResponse>(
        httpResponse.status >= 200 && httpResponse.status < 300 ? 'ok' : 'service-unavailable',
        undefined as TResponse,
        httpResponse.status >= 200 && httpResponse.status < 300,
      );
    }
    // isSuccessful is THE signal (wire-contracts §1.2): an envelope without it is unsuccessful.
    const isSuccessful = response.isSuccessful === true;
    const payload =
      !isSuccessful || response.body === undefined || response.body === ''
        ? undefined
        : (JSON.parse(response.body) as TResponse);

    return BenzeneResult.set<TResponse>(response.statusCode, payload as TResponse, isSuccessful);
  }

  dispose(): void {
    // No held resources — fetch has no connection handle to release.
  }
}

/**
 * A no-op `IBenzeneMessageClient` for a service with no downstream wired: the terminal `shipping`
 * service, or any service run standalone with `DOWNSTREAM_MSG_URL` unset. Mirrors .NET's
 * `NullBenzeneMessageClient` — every send is accepted without a real next hop, so the chaining handlers
 * still resolve and run unchanged.
 */
function tryParseEnvelope(text: string): BenzeneMessageEnvelopeResponse | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === 'object' && parsed !== null && typeof (parsed as { statusCode?: unknown }).statusCode === 'string'
      ? (parsed as BenzeneMessageEnvelopeResponse)
      : undefined;
  } catch {
    return undefined;
  }
}

export class NullBenzeneMessageClient implements IBenzeneMessageClient {
  sendMessageAsync<TRequest, TResponse>(
    _request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    return Promise.resolve(BenzeneResult.accepted<TResponse>());
  }

  dispose(): void {
    // Nothing to release.
  }
}
