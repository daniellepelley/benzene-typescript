import { describe, expect, it } from 'vitest';
import { OAuth2BearerOptions, requireScope, useOAuth2Bearer } from '@benzene/auth-oauth2';
import { createSecureEvent, runSecure } from './authHost';
import { FakeJwksServer, withJwks } from './FakeJwksServer';

/**
 * Port of test/Benzene.Core.Test/Auth/RequireScopeTest.cs: `requireScope` chained after
 * `useOAuth2Bearer` in one pipeline (the realistic composition), driven through the API Gateway HTTP
 * host against a real loopback JWKS endpoint. `GET /secure` is the scope-protected downstream route.
 */

const Issuer = 'https://issuer.example.com';
const Audience = 'my-api';

function optionsFor(jwks: FakeJwksServer): OAuth2BearerOptions {
  const options = new OAuth2BearerOptions();
  options.jwksUri = jwks.jwksUri;
  options.validIssuers = [Issuer];
  options.validAudiences = [Audience];
  options.validAlgorithms = ['RS256'];
  options.requireHttpsMetadata = false;
  return options;
}

/** Runs the OAuth2Bearer -> RequireScope pipeline for `authorization`, returning the HTTP status. */
async function statusFor(
  jwks: FakeJwksServer,
  requiredScopes: string[],
  authorization?: string,
): Promise<number> {
  const response = await runSecure((api) => {
    useOAuth2Bearer(api, optionsFor(jwks));
    requireScope(api, ...requiredScopes);
  }, createSecureEvent(authorization));
  return response.statusCode;
}

function bearerFor(key: Awaited<ReturnType<FakeJwksServer['addKey']>>, claims: Record<string, unknown>) {
  return FakeJwksServer.createToken(key, 'kid1', Issuer, Audience, claims).then((t) => `Bearer ${t}`);
}

describe('RequireScope (via API Gateway host)', () => {
  it('no Authorization header at all is Unauthorized, not Forbidden', async () => {
    await withJwks(async (jwks) => {
      await jwks.addKey('kid1');
      // No principal at all - Unauthorized, never Forbidden.
      expect(await statusFor(jwks, ['admin'])).toBe(401);
    });
  });

  it('a valid token missing the required scope is Forbidden', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const auth = await bearerFor(key, { scope: 'read write' });
      // Authenticated but not permitted - Forbidden, distinct from the no-principal Unauthorized case.
      expect(await statusFor(jwks, ['admin'], auth)).toBe(403);
    });
  });

  it('a space-delimited scope claim containing the required scope passes through', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const auth = await bearerFor(key, { scope: 'read admin write' });
      expect(await statusFor(jwks, ['admin'], auth)).toBe(200);
    });
  });

  it('an scp claim as a plain string containing the required scope passes through', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const auth = await bearerFor(key, { scp: 'read admin' });
      expect(await statusFor(jwks, ['admin'], auth)).toBe(200);
    });
  });

  it('an scp claim as a JSON array containing the required scope passes through', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const auth = await bearerFor(key, { scp: '["read","admin"]' });
      expect(await statusFor(jwks, ['admin'], auth)).toBe(200);
    });
  });

  it('a token with the scope reaches the handler; one without does not', async () => {
    await withJwks(async (jwks) => {
      const key = await jwks.addKey('kid1');
      const good = await bearerFor(key, { scope: 'admin' });
      const bad = await bearerFor(key, { scope: 'read' });

      expect(await statusFor(jwks, ['admin'], good)).toBe(200);
      expect(await statusFor(jwks, ['admin'], bad)).toBe(403);
    });
  });
});
