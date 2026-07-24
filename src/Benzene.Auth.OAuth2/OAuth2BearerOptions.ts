/**
 * Configuration for {@link useOAuth2Bearer}. Every field below is deliberately required, with no
 * permissive silent default - see each property's remarks for why.
 * Port of Benzene.Auth.OAuth2.OAuth2BearerOptions.
 */
export class OAuth2BearerOptions {
  /**
   * The OIDC discovery URL (".../.well-known/openid-configuration"), used to fetch and auto-refresh
   * the JWKS. Set this OR {@link jwksUri}, not both - most identity providers (Auth0, Cognito, Azure
   * AD, Okta) expose full OIDC discovery; {@link jwksUri} is the escape hatch for ones that only
   * publish a bare JWKS document.
   */
  authority?: string;

  /**
   * A bare JWKS document URL, for identity providers that don't expose full OIDC discovery. Set this OR
   * {@link authority}, not both.
   */
  jwksUri?: string;

  /**
   * Every issuer this service trusts. Required - a token whose `iss` claim isn't in this list is
   * rejected. No default: an empty list must fail fast at wire-up, not silently accept tokens from any
   * issuer.
   */
  validIssuers: string[] = [];

  /**
   * Every audience this service accepts. Required for the same reason as {@link validIssuers} - a token
   * minted for a different service must not be accepted here (the classic token-confusion mistake).
   */
  validAudiences: string[] = [];

  /**
   * Explicit signing-algorithm allowlist (e.g. `"RS256"`). Required, no default: a JWT validator that
   * trusts whatever `alg` the token itself claims is vulnerable to algorithm-confusion attacks (RFC
   * 8725 §3.1) - this library will not do that.
   */
  validAlgorithms: string[] = [];

  /**
   * Clock skew tolerance applied to `exp`/`nbf` validation, in seconds. Defaults to 120 (2 minutes).
   * Port of C# `ClockSkew` (a `TimeSpan`); expressed as seconds here to match jose's `clockTolerance`.
   */
  clockToleranceSeconds = 120;

  /**
   * Whether {@link authority}/{@link jwksUri} must be fetched over HTTPS. Defaults to `true` - fetching
   * the document that establishes trust (the JWKS) over plain HTTP is vulnerable to a
   * man-in-the-middle substituting a different signing key. Set to `false` only for local
   * development/testing against a plain-HTTP fake JWKS endpoint. Never set this `false` in production.
   */
  requireHttpsMetadata = true;

  /**
   * Validates this instance, throwing for any wire-up mistake that would otherwise silently
   * under-validate every token this middleware sees. Called by {@link useOAuth2Bearer} at pipeline
   * wire-up time - fail fast, not on the first request.
   */
  validate(): void {
    const hasAuthority = this.authority !== undefined && this.authority.trim() !== '';
    const hasJwksUri = this.jwksUri !== undefined && this.jwksUri.trim() !== '';

    if (hasAuthority === hasJwksUri) {
      throw new Error('Exactly one of authority or jwksUri must be set (not both, not neither).');
    }

    if (this.validIssuers.length === 0) {
      throw new Error(
        'validIssuers must contain at least one trusted issuer - an empty list would accept tokens from any issuer.',
      );
    }

    if (this.validAudiences.length === 0) {
      throw new Error(
        'validAudiences must contain at least one accepted audience - an empty list would accept tokens minted for any audience.',
      );
    }

    if (this.validAlgorithms.length === 0) {
      throw new Error(
        'validAlgorithms must contain at least one allowed signing algorithm - ' +
          'an empty list would trust whatever "alg" the token itself claims (RFC 8725 §3.1 algorithm confusion).',
      );
    }
  }
}
