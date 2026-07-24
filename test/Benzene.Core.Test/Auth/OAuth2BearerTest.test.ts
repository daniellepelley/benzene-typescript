import { describe, expect, it } from 'vitest';
import { OAuth2BearerOptions, useOAuth2Bearer } from '@benzene/auth-oauth2';
import { createSecureEvent, runSecure } from './authHost';
import { FakeJwksServer, withJwks } from './FakeJwksServer';

/**
 * Port of test/Benzene.Core.Test/Auth/OAuth2BearerTest.cs. The C# test hosts a real Kestrel pipeline
 * and a real loopback JWKS endpoint; here the same behaviors run through the API Gateway HTTP host (see
 * authHost.ts) against the same loopback JWKS endpoint (see FakeJwksServer.ts).
 */

const Issuer = 'https://issuer.example.com';
const Audience = 'my-api';

function optionsFor(jwks: FakeJwksServer, validAlgorithms: string[] = ['RS256']): OAuth2BearerOptions {
  const options = new OAuth2BearerOptions();
  options.jwksUri = jwks.jwksUri;
  options.validIssuers = [Issuer];
  options.validAudiences = [Audience];
  options.validAlgorithms = validAlgorithms;
  // FakeJwksServer is a plain-HTTP loopback test double, not a real identity provider.
  options.requireHttpsMetadata = false;
  return options;
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

describe('OAuth2Bearer (via API Gateway host)', () => {
  it('a valid token passes through', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const token = await FakeJwksServer.createToken(key, 'kid1', Issuer, Audience);

      const response = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks)),
        createSecureEvent(bearer(token)),
      );

      expect(response.statusCode).toBe(200);
    });
  });

  it('an expired token is Unauthorized', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const now = Math.floor(Date.now() / 1000);
      const token = await FakeJwksServer.createToken(key, 'kid1', Issuer, Audience, {}, {
        expSeconds: now - 300,
        nbfSeconds: now - 600,
      });

      const response = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks)),
        createSecureEvent(bearer(token)),
      );

      expect(response.statusCode).toBe(401);
    });
  });

  it('a token from the wrong issuer is Unauthorized', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const token = await FakeJwksServer.createToken(
        key,
        'kid1',
        'https://a-different-issuer.example.com',
        Audience,
      );

      const response = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks)),
        createSecureEvent(bearer(token)),
      );

      expect(response.statusCode).toBe(401);
    });
  });

  it('a token for the wrong audience is Unauthorized', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const token = await FakeJwksServer.createToken(key, 'kid1', Issuer, 'a-different-audience');

      const response = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks)),
        createSecureEvent(bearer(token)),
      );

      expect(response.statusCode).toBe(401);
    });
  });

  it('a token signed with a disallowed algorithm is Unauthorized', async () => {
    // The algorithm-confusion test: options only allow RS256, but this token is HMAC-signed (HS256). An
    // explicit allowlist (not the token's self-declared alg) is what this package requires.
    await withJwks(async (jwks) => {
      await jwks.addKey('kid1');
      const token = await FakeJwksServer.createHmacSignedToken(
        Issuer,
        Audience,
        'some-arbitrary-shared-secret-value',
      );

      const response = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks, ['RS256'])),
        createSecureEvent(bearer(token)),
      );

      expect(response.statusCode).toBe(401);
    });
  });

  it('a missing Authorization header is Unauthorized', async () => {
    await withJwks(async (jwks) => {
      await jwks.addKey('kid1');

      const response = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks)),
        createSecureEvent(),
      );

      expect(response.statusCode).toBe(401);
    });
  });

  it('a malformed (non-Bearer) Authorization header is Unauthorized', async () => {
    await withJwks(async (jwks) => {
      await jwks.addKey('kid1');

      const response = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks)),
        createSecureEvent('Basic dXNlcjpwYXNz'),
      );

      expect(response.statusCode).toBe(401);
    });
  });

  it('multiple keys in the JWKS both validate (signing key resolved by kid)', async () => {
    await withJwks(async (jwks) => {
      const key1 = await jwks.addKey('kid1');
      const key2 = await jwks.addKey('kid2');
      const options = optionsFor(jwks);

      const token1 = await FakeJwksServer.createToken(key1, 'kid1', Issuer, Audience);
      const response1 = await runSecure(
        (api) => useOAuth2Bearer(api, options),
        createSecureEvent(bearer(token1)),
      );
      expect(response1.statusCode).toBe(200);

      const token2 = await FakeJwksServer.createToken(key2, 'kid2', Issuer, Audience);
      const response2 = await runSecure(
        (api) => useOAuth2Bearer(api, optionsFor(jwks)),
        createSecureEvent(bearer(token2)),
      );
      expect(response2.statusCode).toBe(200);
    });
  });
});
