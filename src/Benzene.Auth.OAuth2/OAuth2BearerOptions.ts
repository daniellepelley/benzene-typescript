/**
 * Configuration for {@link useOAuth2Bearer}. Every field below is deliberately required, with no
 * permissive silent default - see each property's remarks for why.
 * Port of Benzene.Auth.OAuth2.OAuth2BearerOptions.
 */
export class OAuth2BearerOptions {
  /**
   * Signing algorithms {@link validAlgorithms} entries are checked against - the standard JWS signing
   * algorithms (RFC 7518 §3.1) plus `EdDSA` (RFC 8037 §3.1). Port of C#
   * `OAuth2BearerOptions.KnownSigningAlgorithms` (which mirrors
   * `Microsoft.IdentityModel.Tokens.SecurityAlgorithms`' JWS constants); `EdDSA` is a TS-ecosystem
   * addition because `jose` — the library this package adapts — supports it first-class, while .NET's
   * `SecurityAlgorithms` has no constant for it. Deliberately narrow: only names a bearer-token
   * validator's allowlist can legitimately contain, matched case-sensitively (JWS `alg` values are
   * case-sensitive per RFC 7515 §4.1.1, and .NET compares Ordinal).
   */
  private static readonly knownSigningAlgorithms: ReadonlySet<string> = new Set([
    'HS256', 'HS384', 'HS512',
    'RS256', 'RS384', 'RS512',
    'ES256', 'ES384', 'ES512',
    'PS256', 'PS384', 'PS512',
    'EdDSA',
  ]);

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

    // #174/#244: each entry must itself be a genuine signing-algorithm name — a non-empty allowlist
    // containing "none", a whitespace entry, or a typo'd name is exactly as dangerous (or as silently
    // useless) as the empty-list case above, and must fail fast at wire-up, not at first verify.
    for (const algorithm of this.validAlgorithms) {
      if (algorithm === undefined || algorithm === null || algorithm.trim() === '') {
        throw new Error(
          'validAlgorithms contains a null/empty/whitespace entry - every entry must be a genuine signing algorithm name.',
        );
      }

      // Explicit, named rejection - RFC 8725 §3.1's canonical algorithm-confusion attack is exactly
      // "alg": "none" accepted by a validator that never meant to allow it. Called out separately
      // from the "unrecognized name" check below so the error is unambiguous about why.
      if (algorithm.toLowerCase() === 'none') {
        throw new Error(
          'validAlgorithms must not contain "none" - accepting the unsigned algorithm defeats ' +
            'signature validation entirely (RFC 8725 §3.1 algorithm confusion).',
        );
      }

      if (!OAuth2BearerOptions.knownSigningAlgorithms.has(algorithm)) {
        throw new Error(
          `validAlgorithms contains '${algorithm}', which is not a recognized JWS signing algorithm - ` +
            'likely a typo that would silently make this entry unmatchable by any real token.',
        );
      }
    }
  }
}
