/**
 * Port of Benzene.Mesh.Artifacts.MeshDispatchGuardMiddleware (+ MeshPathCanonicalizer).
 *
 * PLACEMENT DIVERGENCE: in .NET this middleware lives in `Benzene.Mesh.Artifacts` ("this is an HTTP
 * concern about a mesh endpoint, and the package it protects is transport-agnostic"). The TypeScript
 * port has no `Benzene.Mesh.Artifacts` package yet, so the guard lives here alongside the options,
 * limiter and identity it composes; move it out if/when an artifacts package is ported.
 */
import { ILogger } from '@benzenejs/abstractions';
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { HttpRequest, IHttpContext, IHttpRequestAdapter, IRouteFinder } from '@benzenejs/http';
import { MeshDispatchGuardOptions } from './MeshDispatchGuardOptions';
import { MeshDispatchIdentity } from './MeshDispatchIdentity';
import { MeshDispatchRateLimiter } from './MeshDispatchRateLimiter';

/**
 * Normalizes a path exactly as the router does (query string stripped, empty segments collapsed —
 * including a trailing slash — lower-cased), so every path-scoped check in the mesh host agrees with
 * the router on what counts as the same path. A trailing-slash mismatch between an exact-match
 * comparison and this normalization was exactly this class of bug in .NET (corrected 2026-08-22): a
 * request to `/mesh/dispatch/` (one added slash) missed a raw exact-match check entirely while the
 * router still normalized the slash away and delivered the request to the real handler — a full
 * bypass. Port of `MeshPathCanonicalizer.Canonicalize`.
 */
export function canonicalizeMeshPath(path: string | undefined): string {
  const beforeQuery = (path ?? '').split('?').find((s) => s !== '') ?? '';
  const segments = beforeQuery.split('/').filter((s) => s !== '');
  return ('/' + segments.join('/')).toLowerCase();
}

/**
 * The shared path-OR-topic predicate: true when `requestPath` canonicalizes to
 * `guardedCanonicalPath`, OR (when both a `topic` and a `routeFinder` are available) when the route
 * finder resolves `requestMethod`/`requestPath` to that same topic — a route alias that reaches the
 * guarded topic under a different literal path cannot slip past either check this way. Port of
 * `MeshPathCanonicalizer.IsPathOrTopicMatch` (.NET #287).
 */
export function isMeshPathOrTopicMatch(
  requestMethod: string | undefined,
  requestPath: string | undefined,
  guardedCanonicalPath: string,
  topic: string | undefined,
  routeFinder: IRouteFinder | undefined,
): boolean {
  if (canonicalizeMeshPath(requestPath) === guardedCanonicalPath) {
    return true;
  }

  if (topic === undefined || topic === '' || routeFinder === undefined) {
    return false;
  }

  const matchedTopic = routeFinder.find(requestMethod ?? '', requestPath ?? '')?.topic;
  return matchedTopic !== undefined && matchedTopic.toLowerCase() === topic.toLowerCase();
}

/**
 * Guards the HTTP endpoint that dispatches a caller-supplied payload into a service's real handler.
 *
 * The checks run in this order and short-circuit on each — cheapest and most certain first, so a
 * caller who fails the header check costs a string comparison rather than a parse:
 *
 * 1. **CSRF** — the request must carry `MeshDispatchGuardOptions.headerName`. A cross-site form
 *    cannot set a custom header, and a cross-origin fetch that sets one is preflighted.
 * 2. **Identity** — established upstream by the session gate. **Fails closed**: no identity below an
 *    auth gate is an invariant violation, and a dispatch nobody can be attributed to must not run,
 *    because the audit record would be blind.
 * 3. **Size** — the request body's actual byte count (via the transport's registered body getter,
 *    which serves the up-front-buffered body — the port of .NET's `HttpRequestBodyBuffer`; the
 *    caller-supplied `Content-Length` header, which a chunked request omits entirely, is only the
 *    fallback) against `maxRequestBytes`, before anything is deserialized.
 * 4. **Rate** — per identity, per minute. The per-*target* limit is not here: the target service is
 *    inside the body, which this layer deliberately does not parse, so the handler applies it where
 *    the parsed request already exists.
 *
 * **Refusals are shaped for their reader.** The size and rate-limit refusals are written as a
 * Benzene *envelope* with a Benzene status, not as a bare HTTP status, because the mesh UI reads the
 * envelope's status and renders its message; a bare 429 falls into its generic failure path and
 * reads as "something broke" rather than "you are going too fast". The CSRF and no-identity
 * refusals stay bare 403s with a fixed body — those callers are attackers or bugs, and get the
 * no-detail treatment.
 */
export class MeshDispatchGuardMiddleware<TContext extends IHttpContext> implements IMiddleware<TContext> {
  private readonly guardedPath: string;

  /**
   * @param bodyGetter Optional. When the transport buffers its request body up front (e.g. the
   * Express host's `rawBody`), the registered `IMessageBodyGetter` serves the request's ACTUAL byte
   * count instead of trusting the caller-supplied `Content-Length` header (the .NET #35 fix: a
   * chunked `Transfer-Encoding` request carries no `Content-Length` at all, which let an oversized
   * chunked body sail straight past a header-only check). `undefined` on a transport that doesn't
   * buffer (e.g. AWS API Gateway, where the body arrives pre-materialized and `Content-Length` is
   * trustworthy), which falls back to the header check.
   */
  constructor(
    private readonly options: MeshDispatchGuardOptions,
    private readonly identity: MeshDispatchIdentity,
    private readonly limiter: MeshDispatchRateLimiter,
    private readonly requestAdapter: IHttpRequestAdapter<TContext>,
    private readonly responseAdapter: IBenzeneResponseAdapter<TContext>,
    private readonly routeFinder?: IRouteFinder,
    private readonly logger?: ILogger,
    private readonly bodyGetter?: IMessageBodyGetter<TContext>,
  ) {
    this.guardedPath = canonicalizeMeshPath(options.path);
  }

  readonly name = 'MeshDispatchGuard';

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const request = this.requestAdapter.map(context);

    if (!this.isGuarded(request)) {
      await next();
      return;
    }

    if (!hasHeader(request, this.options.headerName)) {
      this.logger?.logWarning(`Mesh dispatch refused: required header ${this.options.headerName} was absent`);
      await this.denyAsync(context, '403', 'forbidden');
      return;
    }

    // FAIL CLOSED. Reaching here without an identity means the session gate is missing or was
    // mounted after this guard - a wiring error, and one that would silently produce
    // unattributable dispatches. Refusing is the only safe reading.
    if (this.identity.email === undefined || this.identity.email.trim() === '') {
      this.logger?.logWarning(
        'Mesh dispatch refused: no identity was established. Is this guard mounted above the session gate?',
      );
      await this.denyAsync(context, '403', 'forbidden');
      return;
    }

    if (this.requestBodyBytes(context, request) > this.options.maxRequestBytes) {
      this.logger?.logWarning(
        `Mesh dispatch refused for ${this.identity.email}: payload over ${this.options.maxRequestBytes} bytes`,
      );
      await this.denyEnvelopeAsync(
        context,
        '413',
        'bad-request',
        `That payload is larger than this mesh accepts (${this.options.maxRequestBytes.toLocaleString('en-US')} bytes).`,
      );
      return;
    }

    this.limiter.prune();
    const acquired = this.limiter.tryAcquire(
      `identity:${this.identity.email}`,
      this.options.maxPerMinutePerIdentity,
    );
    if (!acquired.allowed) {
      this.logger?.logInformation(`Mesh dispatch throttled for ${this.identity.email}`);
      this.responseAdapter.setResponseHeader(context, 'Retry-After', String(acquired.retryAfterSeconds));
      await this.denyEnvelopeAsync(
        context,
        '429',
        'too-many-requests',
        `You have reached this mesh's dispatch limit of ${this.options.maxPerMinutePerIdentity} a minute. ` +
          `Try again in ${acquired.retryAfterSeconds}s.`,
      );
      return;
    }

    await next();
  }

  /**
   * Path match, plus a topic match through the route finder, so a route alias that reaches the
   * handler cannot reach it around this guard (via the shared {@link isMeshPathOrTopicMatch}
   * predicate, .NET #287).
   */
  private isGuarded(request: HttpRequest): boolean {
    return isMeshPathOrTopicMatch(
      request.method,
      request.path,
      this.guardedPath,
      this.options.topic,
      this.routeFinder,
    );
  }

  /**
   * Measures the size check should bound against: the ACTUAL body byte count when the transport
   * buffered it (see the constructor's `bodyGetter` note), falling back to the `Content-Length`
   * header only when nothing can serve the body.
   */
  private requestBodyBytes(context: TContext, request: HttpRequest): number {
    if (this.bodyGetter !== undefined) {
      const body = this.bodyGetter.getBody(context);
      return body === undefined || body === null ? 0 : new TextEncoder().encode(body).length;
    }

    return contentLength(request);
  }

  /** A refusal for a caller who should not be told anything: fixed body, no detail. */
  private async denyAsync(context: TContext, statusCode: string, error: string): Promise<void> {
    this.responseAdapter.setStatusCode(context, statusCode);
    this.responseAdapter.setContentType(context, 'application/json');
    this.responseAdapter.setBody(context, `{"error":"${error}"}`);
    await this.responseAdapter.finalizeAsync(context);
  }

  /**
   * A refusal for the mesh UI: a Benzene envelope, because the page reads the envelope's status and
   * renders its message. A bare HTTP status here would render as an unexplained failure.
   */
  private async denyEnvelopeAsync(
    context: TContext,
    httpStatus: string,
    benzeneStatus: string,
    message: string,
  ): Promise<void> {
    this.responseAdapter.setStatusCode(context, httpStatus);
    this.responseAdapter.setContentType(context, 'application/json');
    this.responseAdapter.setBody(
      context,
      `{"statusCode":"${benzeneStatus}","headers":{},"body":${JSON.stringify(message)}}`,
    );
    await this.responseAdapter.finalizeAsync(context);
  }
}

function hasHeader(request: HttpRequest, name: string): boolean {
  if (request.headers === undefined || request.headers === null) {
    return false;
  }

  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name.toLowerCase() && value !== undefined && value.trim() !== '') {
      return true;
    }
  }

  return false;
}

function contentLength(request: HttpRequest): number {
  if (request.headers === undefined || request.headers === null) {
    return 0;
  }

  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === 'content-length') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  // An absent Content-Length is not evidence of a small body, but it is also not something this
  // layer can measure without buffering. Only reached on a transport with no buffered body getter
  // — see requestBodyBytes, which prefers the actual buffered size wherever the transport
  // provides one.
  return 0;
}
