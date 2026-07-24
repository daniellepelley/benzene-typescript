import { createRemoteJWKSet, JWTVerifyGetKey } from 'jose';
import { OAuth2BearerOptions } from './OAuth2BearerOptions';

/**
 * Builds the single, long-lived JWKS key resolver used by {@link useOAuth2Bearer} - constructed once
 * at pipeline wire-up time (not per request/per message), so its JWKS caching/refresh-on-unrecognized-
 * `kid` behavior actually caches across requests instead of hitting the identity provider every time.
 *
 * Port of Benzene.Auth.OAuth2.OAuth2ConfigurationManagerFactory. The .NET version returns a
 * `ConfigurationManager<OpenIdConnectConfiguration>` (with a separate `OpenIdConnectConfigurationRetriever`
 * for the OIDC-discovery path and a `JwksOnlyConfigurationRetriever` for the bare-JWKS path). jose's
 * `createRemoteJWKSet` collapses both retrievers and the caching `ConfigurationManager` into one native
 * key resolver, so the port fans out to it directly and the `JwksOnlyConfigurationRetriever` file has no
 * TypeScript counterpart. The OIDC-discovery path is a thin lazy wrapper that resolves `jwks_uri` from
 * the discovery document on first use before delegating to a remote JWK set.
 */
export const OAuth2ConfigurationManagerFactory = {
  create(options: OAuth2BearerOptions): JWTVerifyGetKey {
    if (options.jwksUri !== undefined && options.jwksUri.trim() !== '') {
      ensureAllowedScheme(options.jwksUri, options.requireHttpsMetadata);
      return createRemoteJWKSet(new URL(options.jwksUri));
    }

    return createDiscoveryKeyResolver(options);
  },
};

function createDiscoveryKeyResolver(options: OAuth2BearerOptions): JWTVerifyGetKey {
  const authority = options.authority!;
  ensureAllowedScheme(authority, options.requireHttpsMetadata);

  let inner: JWTVerifyGetKey | undefined;

  const getKey: JWTVerifyGetKey = async (protectedHeader, token) => {
    if (inner === undefined) {
      const response = await fetch(authority);
      if (!response.ok) {
        throw new Error(
          `OIDC discovery request to '${authority}' failed with status ${response.status}.`,
        );
      }

      const document = (await response.json()) as { jwks_uri?: string };
      const jwksUri = document.jwks_uri;
      if (jwksUri === undefined || jwksUri.trim() === '') {
        throw new Error(`OIDC discovery document at '${authority}' has no jwks_uri.`);
      }

      ensureAllowedScheme(jwksUri, options.requireHttpsMetadata);
      inner = createRemoteJWKSet(new URL(jwksUri));
    }

    return inner(protectedHeader, token);
  };

  return getKey;
}

/**
 * Enforces {@link OAuth2BearerOptions.requireHttpsMetadata}: the document that establishes trust (the
 * JWKS/discovery doc) must be fetched over HTTPS unless explicitly opted out for local testing. This is
 * the port's equivalent of C#'s `HttpDocumentRetriever.RequireHttps`.
 */
function ensureAllowedScheme(url: string, requireHttps: boolean): void {
  if (requireHttps && !url.toLowerCase().startsWith('https:')) {
    throw new Error(
      `'${url}' must be an https URL when requireHttpsMetadata is true (the default). ` +
        'Set requireHttpsMetadata to false only for local development against a plain-HTTP endpoint.',
    );
  }
}
