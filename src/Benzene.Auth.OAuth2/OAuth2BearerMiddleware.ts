import { errors, JWTPayload, JWTVerifyGetKey, JWTVerifyOptions, jwtVerify } from 'jose';
import { ILogger, IServiceResolver } from '@benzene/abstractions';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import {
  AuthenticationHolder,
  AuthResults,
  Claim,
  ClaimsIdentity,
  ClaimsPrincipal,
} from '@benzene/auth-core';
import { IHttpContext, IHttpRequestAdapter } from '@benzene/http';

const schemePrefix = 'Bearer ';

/**
 * OAuth2 bearer token (JWT) validation middleware: reads `Authorization: Bearer <token>`, validates it
 * against the pre-built key resolver and verify options (signature, issuer, audience, algorithm,
 * lifetime - see {@link useOAuth2Bearer}), and either short-circuits with `Unauthorized` or sets
 * {@link AuthenticationHolder.principal} and calls `next()`.
 *
 * Port of Benzene.Auth.OAuth2.OAuth2BearerMiddleware&lt;TContext&gt;. C#'s `JsonWebTokenHandler` +
 * `TokenValidationParameters` map to jose's `jwtVerify` + a `JWTVerifyGetKey` resolver; the expensive,
 * genuinely-reusable pieces (the caching remote JWK set and the verify options) are built once at
 * wire-up time by {@link useOAuth2Bearer} and passed in, not rebuilt per message. The middleware is
 * re-resolved per message because it captures the per-message {@link AuthenticationHolder}.
 */
export class OAuth2BearerMiddleware<TContext extends IHttpContext> implements IMiddleware<TContext> {
  readonly name = 'OAuth2Bearer';

  constructor(
    private readonly keyResolver: JWTVerifyGetKey,
    private readonly verifyOptions: JWTVerifyOptions,
    private readonly httpRequestAdapter: IHttpRequestAdapter<TContext>,
    private readonly holder: AuthenticationHolder,
    private readonly logger: ILogger,
    private readonly resolver: IServiceResolver,
  ) {}

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const httpRequest = this.httpRequestAdapter.map(context);

    const authorizationHeader = getHeader(httpRequest.headers, 'authorization');
    if (
      authorizationHeader === undefined ||
      authorizationHeader === '' ||
      !authorizationHeader.toLowerCase().startsWith(schemePrefix.toLowerCase())
    ) {
      await AuthResults.unauthorizedAsync(this.resolver, context, 'Missing bearer token');
      return;
    }

    const token = authorizationHeader.substring(schemePrefix.length).trim();
    if (token === '') {
      await AuthResults.unauthorizedAsync(this.resolver, context, 'Missing bearer token');
      return;
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keyResolver, this.verifyOptions));
    } catch (error) {
      // jose reports every validation failure (bad signature, expired, wrong issuer/audience/algorithm)
      // by throwing a JOSEError, and infrastructure failures (an unreachable JWKS endpoint) by throwing
      // an ordinary Error. Never echo the real reason back to the caller (a bad signature vs. an expired
      // token vs. a wrong audience is an oracle for an attacker probing token shapes) - log it
      // server-side only, and distinguish the two the way the .NET middleware does.
      if (error instanceof errors.JOSEError) {
        this.logger.logInformation('OAuth2 bearer token failed validation');
      } else {
        this.logger.logError(error, 'OAuth2 bearer token validation threw unexpectedly');
      }
      await AuthResults.unauthorizedAsync(this.resolver, context, 'Invalid bearer token');
      return;
    }

    this.holder.principal = claimsPrincipalFromPayload(payload);
    await next();
  }
}

/** Case-insensitive header lookup, the port of C#'s `HttpRequest.AsLowerCase()` + `TryGetValue`. */
function getHeader(headers: Record<string, string>, key: string): string | undefined {
  const lowerKey = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === lowerKey) {
      return headerValue;
    }
  }
  return undefined;
}

/**
 * Builds a {@link ClaimsPrincipal} from a validated JWT payload, mirroring how .NET's
 * `JsonWebTokenHandler` turns token claims into a `ClaimsIdentity`: each payload entry becomes a
 * {@link Claim}, and a JSON-array claim value becomes one claim per element (so `scp`/`roles` arrays are
 * read element by element downstream).
 */
function claimsPrincipalFromPayload(payload: JWTPayload): ClaimsPrincipal {
  const claims: Claim[] = [];
  for (const [type, value] of Object.entries(payload)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        claims.push(new Claim(type, stringifyClaimValue(item)));
      }
    } else {
      claims.push(new Claim(type, stringifyClaimValue(value)));
    }
  }

  return new ClaimsPrincipal(new ClaimsIdentity(claims, 'Bearer'));
}

function stringifyClaimValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
