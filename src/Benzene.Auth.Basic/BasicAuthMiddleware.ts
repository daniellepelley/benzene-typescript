import { IServiceResolver } from '@benzene/abstractions';
import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { AuthenticationHolder, AuthResults } from '@benzene/auth-core';
import { IHttpContext, IHttpRequestAdapter } from '@benzene/http';
import { IBasicAuthCredentialValidator } from './IBasicAuthCredentialValidator';

const schemePrefix = 'Basic ';

/**
 * RFC 7617 HTTP Basic authentication middleware: reads `Authorization: Basic <base64>`, validates the
 * decoded username/password against an {@link IBasicAuthCredentialValidator}, and either
 * short-circuits with `Unauthorized` or sets {@link AuthenticationHolder.principal} and calls `next()`.
 *
 * Port of Benzene.Auth.Basic.BasicAuthMiddleware&lt;TContext&gt;.
 *
 * The middleware's constructor captures the per-message {@link AuthenticationHolder}; the pipeline's
 * factory re-runs per message with the message's scoped resolver, so a fresh holder is captured each
 * time (the C# "registered scoped" behavior).
 */
export class BasicAuthMiddleware<TContext extends IHttpContext> implements IMiddleware<TContext> {
  readonly name = 'BasicAuth';

  constructor(
    private readonly validator: IBasicAuthCredentialValidator,
    private readonly realm: string,
    private readonly httpRequestAdapter: IHttpRequestAdapter<TContext>,
    private readonly responseAdapter: IBenzeneResponseAdapter<TContext>,
    private readonly holder: AuthenticationHolder,
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
      await this.challengeAsync(context, 'Missing or malformed Authorization header');
      return;
    }

    const encodedCredentials = authorizationHeader.substring(schemePrefix.length).trim();

    const decodedCredentials = decodeBase64Utf8(encodedCredentials);
    if (decodedCredentials === undefined) {
      await this.challengeAsync(context, 'Malformed Basic credentials');
      return;
    }

    // Split on the FIRST ':' only - RFC 7617 explicitly allows ':' inside the password, so a naive
    // split(':') would truncate or misassign it.
    const separatorIndex = decodedCredentials.indexOf(':');
    if (separatorIndex < 0) {
      await this.challengeAsync(context, 'Malformed Basic credentials');
      return;
    }

    const username = decodedCredentials.substring(0, separatorIndex);
    const password = decodedCredentials.substring(separatorIndex + 1);

    const principal = await this.validator.validateAsync(username, password);
    if (principal === undefined) {
      await this.challengeAsync(context, 'Invalid credentials');
      return;
    }

    this.holder.principal = principal;
    await next();
  }

  private challengeAsync(context: TContext, detail: string): Promise<void> {
    // Per RFC 7617, a 401 response to a request without valid credentials SHOULD include a
    // WWW-Authenticate challenge - this is what makes browsers/HTTP clients prompt for credentials, so
    // it's set on every Unauthorized outcome this middleware produces, not just the "header missing
    // entirely" case.
    this.responseAdapter.setResponseHeader(
      context,
      'WWW-Authenticate',
      `Basic realm="${this.realm}"`,
    );
    return AuthResults.unauthorizedAsync(this.resolver, context, detail);
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
 * Strictly decodes a Base64 string to a UTF-8 string, returning `undefined` for input that is not
 * valid Base64. Node's `Buffer.from(..., 'base64')` silently drops invalid characters rather than
 * throwing (unlike C#'s `Convert.FromBase64String`), so the input is validated against the Base64
 * alphabet and padding first to preserve the C# "malformed credentials -> challenge" behavior.
 */
function decodeBase64Utf8(encoded: string): string | undefined {
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    return undefined;
  }
  return Buffer.from(encoded, 'base64').toString('utf8');
}
