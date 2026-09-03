import { describe, expect, it } from 'vitest';
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { HttpRequest, IHttpContext, IHttpRequestAdapter } from '@benzenejs/http';
import {
  MeshDispatchGuardMiddleware,
  MeshDispatchGuardOptions,
  MeshDispatchIdentity,
  MeshDispatchRateLimiter,
} from '@benzenejs/mesh-dispatch';

/**
 * Port of test/Benzene.Mesh.Test/MeshDispatchGuardMiddlewareTest.cs — the guard in front of the
 * mesh's dispatch endpoint, the one surface that fires a caller's payload into a real handler.
 *
 * Adversarial as much as functional. Several of these exist to pin that a refusal is shaped for its
 * reader: a rate-limited human has to be told they are going too fast, because a bare HTTP status
 * renders in the mesh UI as an unexplained failure, and a reader who cannot tell "throttled" from
 * "broken" files a bug against the wrong thing.
 *
 * .NET's `HttpRequestBodyBuffer` maps to the transport's registered `IMessageBodyGetter` (which
 * serves the up-front-buffered body, e.g. Express's `rawBody`) — see the middleware's constructor.
 */

class FakeHttpContext implements IHttpContext {}

const Now = Date.UTC(2026, 7, 20, 12, 0, 30);

interface HeaderOptions {
  /** `null` means "omit the CSRF header" (an explicit `undefined` would trigger the default). */
  dispatchHeader?: string | null;
  contentLength?: string;
}

function headers({ dispatchHeader = '1', contentLength }: HeaderOptions = {}): Record<string, string> {
  const result: Record<string, string> = {};
  if (dispatchHeader !== null) {
    result['X-Benzene-Dispatch'] = dispatchHeader;
  }
  if (contentLength !== undefined) {
    result['Content-Length'] = contentLength;
  }
  return result;
}

class Harness {
  readonly context = new FakeHttpContext();
  nextCalled = false;
  readonly statusCodes: string[] = [];
  readonly bodies: string[] = [];
  readonly responseHeaders: Record<string, string> = {};
  finalizeCount = 0;

  private readonly middleware: MeshDispatchGuardMiddleware<FakeHttpContext>;

  constructor(init?: {
    path?: string;
    headers?: Record<string, string>;
    email?: string | undefined;
    options?: MeshDispatchGuardOptions;
    limiter?: MeshDispatchRateLimiter;
    bodyGetter?: IMessageBodyGetter<FakeHttpContext>;
  }) {
    const requestAdapter: IHttpRequestAdapter<FakeHttpContext> = {
      map: () => {
        const request = new HttpRequest();
        request.method = 'POST';
        request.path = init?.path ?? '/mesh/dispatch';
        request.headers = init?.headers ?? headers();
        return request;
      },
    };

    const responseAdapter: IBenzeneResponseAdapter<FakeHttpContext> = {
      setResponseHeader: (_c, key, value) => {
        this.responseHeaders[key] = value;
      },
      setContentType: () => {},
      setStatusCode: (_c, statusCode) => {
        this.statusCodes.push(statusCode);
      },
      setBody: (_c, body: string | Uint8Array) => {
        this.bodies.push(typeof body === 'string' ? body : new TextDecoder().decode(body));
      },
      getBody: () => '',
      finalizeAsync: () => {
        this.finalizeCount += 1;
        return Promise.resolve();
      },
    };

    const identity = new MeshDispatchIdentity();
    identity.email = init !== undefined && 'email' in init ? init.email : 'someone@example.com';

    this.middleware = new MeshDispatchGuardMiddleware<FakeHttpContext>(
      init?.options ?? new MeshDispatchGuardOptions(),
      identity,
      init?.limiter ?? new MeshDispatchRateLimiter(() => Now),
      requestAdapter,
      responseAdapter,
      undefined,
      undefined,
      init?.bodyGetter,
    );
  }

  run(): Promise<void> {
    return this.middleware.handleAsync(this.context, () => {
      this.nextCalled = true;
      return Promise.resolve();
    });
  }

  assertAllowed(): void {
    expect(this.nextCalled).toBe(true);
    expect(this.statusCodes).toHaveLength(0);
  }

  assertRefused(httpStatus: string): void {
    expect(this.nextCalled).toBe(false);
    expect(this.statusCodes).toEqual([httpStatus]);
    expect(this.finalizeCount).toBe(1);
  }

  capturedBody(): string {
    return this.bodies[this.bodies.length - 1] ?? '';
  }
}

describe('MeshDispatchGuardMiddlewareTest', () => {
  it('AnythingThatIsNotTheDispatchEndpoint_IsUntouched', async () => {
    const harness = new Harness({ path: '/mesh-ui', headers: headers({ dispatchHeader: null }), email: undefined });
    await harness.run();
    harness.assertAllowed();
  });

  it('ASignedInCallerWithTheHeader_IsAllowedThrough', async () => {
    const harness = new Harness();
    await harness.run();
    harness.assertAllowed();
  });

  it('WithoutTheCsrfHeader_IsRefusedAndTellsTheCallerNothing', async () => {
    // A cross-site form cannot set a custom header. The denial deliberately carries no detail —
    // this caller is an attacker or a bug, and neither is owed a diagnosis.
    const harness = new Harness({ headers: headers({ dispatchHeader: null }) });
    await harness.run();

    harness.assertRefused('403');
    expect(harness.capturedBody()).toBe('{"error":"forbidden"}');
  });

  it('WithoutAnIdentity_FailsClosed', async () => {
    // Reaching the guard with no identity means the session gate is missing or mounted below it.
    // Allowing that would produce dispatches nobody can be held to, which is precisely what the
    // audit record exists to prevent — so the wiring mistake announces itself.
    const harness = new Harness({ email: undefined });
    await harness.run();
    harness.assertRefused('403');
  });

  it('AnOversizedPayload_IsRefusedBeforeAnythingIsParsed', async () => {
    const options = new MeshDispatchGuardOptions();
    options.maxRequestBytes = 1024;
    const harness = new Harness({ headers: headers({ contentLength: '999999' }), options });
    await harness.run();

    harness.assertRefused('413');
    // Envelope-shaped, so the console renders the reason rather than a generic failure.
    expect(harness.capturedBody()).toContain('"statusCode":"bad-request"');
  });

  // Regression for the .NET #35 shape (security, live-verified): a chunked Transfer-Encoding
  // request carries NO Content-Length header at all - so a header-only size check let an oversized
  // chunked body sail straight past the guard. The fix measures the transport's ACTUAL buffered
  // body (the registered body getter) instead of trusting the header.
  it('AnOversizedBufferedBody_IsRefused_EvenWithNoContentLengthHeader', async () => {
    const options = new MeshDispatchGuardOptions();
    options.maxRequestBytes = 1024;
    const harness = new Harness({
      headers: headers({}), // simulates chunked Transfer-Encoding
      options,
      bodyGetter: { getBody: () => 'a'.repeat(2000) },
    });
    await harness.run();

    harness.assertRefused('413');
    expect(harness.capturedBody()).toContain('"statusCode":"bad-request"');
  });

  it('ABufferedBodyWithinTheLimit_IsAllowedThrough_EvenWithNoContentLengthHeader', async () => {
    const options = new MeshDispatchGuardOptions();
    options.maxRequestBytes = 1024;
    const harness = new Harness({
      headers: headers({}),
      options,
      bodyGetter: { getBody: () => 'a'.repeat(100) },
    });
    await harness.run();

    harness.assertAllowed();
  });

  it('WithNoBodyGetter_FallsBackToTheContentLengthHeader', async () => {
    // No body getter resolved (e.g. AWS API Gateway, which never buffers) - the check must still
    // work off the header exactly as before, not silently allow everything through.
    const options = new MeshDispatchGuardOptions();
    options.maxRequestBytes = 1024;
    const harness = new Harness({ headers: headers({ contentLength: '999999' }), options });
    await harness.run();

    harness.assertRefused('413');
  });

  it('PastTheRateLimit_IsRefusedAsAnEnvelopeTheConsoleCanRender', async () => {
    // THE POINT OF THIS TEST. A bare HTTP 429 falls into the UI's generic failure path and reads
    // as "something broke"; the reader then reports a bug instead of slowing down.
    const limiter = new MeshDispatchRateLimiter(() => Now);
    const options = new MeshDispatchGuardOptions();
    options.maxPerMinutePerIdentity = 2;

    for (let i = 0; i < 2; i++) {
      const allowed = new Harness({ options, limiter });
      await allowed.run();
      allowed.assertAllowed();
    }

    const refused = new Harness({ options, limiter });
    await refused.run();

    refused.assertRefused('429');
    expect(refused.capturedBody()).toContain('"statusCode":"too-many-requests"');
    expect(refused.responseHeaders['Retry-After']).toBe('30');
  });

  it("TheRateLimitIsPerIdentity_SoOnePersonCannotSpendAnother_sAllowance", async () => {
    const limiter = new MeshDispatchRateLimiter(() => Now);
    const options = new MeshDispatchGuardOptions();
    options.maxPerMinutePerIdentity = 1;

    const first = new Harness({ email: 'a@example.com', options, limiter });
    await first.run();
    first.assertAllowed();

    const second = new Harness({ email: 'b@example.com', options, limiter });
    await second.run();
    second.assertAllowed();

    const firstAgain = new Harness({ email: 'a@example.com', options, limiter });
    await firstAgain.run();
    firstAgain.assertRefused('429');
  });

  it.each([['/MESH/DISPATCH'], ['//mesh//dispatch'], ['/mesh/dispatch?x=1'], ['/mesh/dispatch/']])(
    'AnOddSpellingOfTheGuardedPath_IsStillGuarded(%s)',
    async (path) => {
      // The guard canonicalises exactly as the router does, or a crafted spelling reaches the
      // handler around the guard rather than through it.
      const harness = new Harness({ path, headers: headers({ dispatchHeader: null }) });
      await harness.run();
      harness.assertRefused('403');
    },
  );
});
