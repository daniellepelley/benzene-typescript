import { describe, expect, it } from 'vitest';
import {
  addAuthorizationPolicy,
  Claim,
  ClaimsIdentity,
  ClaimsPrincipal,
  ClaimTypes,
  IAuthorizationHandler,
  requireAuthorization,
  requirePolicy,
  requireRole,
} from '@benzene/auth-core';
import { IBasicAuthCredentialValidator, useBasicAuth } from '@benzene/auth-basic';
import { createSecureEvent, runSecure, seedPrincipal } from './authHost';

/**
 * Port of test/Benzene.Core.Test/Auth/AuthorizationTest.cs. The C# suite chains the authorization
 * middleware after `UseOAuth2Bearer` in a real Kestrel host; the OAuth2 bearer adapter is not yet
 * ported (it needs a JWT/JWKS runtime dependency), so here the authenticated principal is seeded
 * directly (see authHost.ts `seedPrincipal`) and the authorization primitives are exercised on their
 * own - plus one end-to-end case composing the real `useBasicAuth` authentication with `requireRole`.
 */

/** Builds an authenticated principal carrying the given claims. */
function principalWith(...claims: [type: string, value: string][]): ClaimsPrincipal {
  return new ClaimsPrincipal(
    new ClaimsIdentity(
      claims.map(([type, value]) => new Claim(type, value)),
      'Test',
    ),
  );
}

describe('requireRole', () => {
  it('no authenticated caller is Unauthorized', async () => {
    const response = await runSecure((api) => requireRole(api, 'admin'), createSecureEvent());
    expect(response.statusCode).toBe(401);
  });

  it('authenticated but missing the role is Forbidden', async () => {
    const response = await runSecure((api) => {
      seedPrincipal(api, principalWith(['roles', 'reader']));
      requireRole(api, 'admin');
    }, createSecureEvent());
    expect(response.statusCode).toBe(403);
  });

  it('a matching role claim passes through', async () => {
    const response = await runSecure((api) => {
      seedPrincipal(api, principalWith(['roles', 'admin']));
      requireRole(api, 'admin');
    }, createSecureEvent());
    expect(response.statusCode).toBe(200);
  });

  it('roles as a JSON array (Azure AD app-roles shape) passes through', async () => {
    const response = await runSecure((api) => {
      seedPrincipal(api, principalWith(['roles', '["reader","admin"]']));
      requireRole(api, 'admin');
    }, createSecureEvent());
    expect(response.statusCode).toBe(200);
  });
});

describe('requirePolicy', () => {
  const isEng = (principal: ClaimsPrincipal): boolean =>
    principal.hasClaim((c) => c.type === 'department' && c.value === 'eng');

  it('an inline policy is satisfied by a claim, otherwise Forbidden', async () => {
    const configure = (department: string) => async () =>
      runSecure((api) => {
        seedPrincipal(api, principalWith(['department', department]));
        requirePolicy(api, 'employees-only', isEng);
      }, createSecureEvent());

    expect((await configure('eng')()).statusCode).toBe(200);
    expect((await configure('sales')()).statusCode).toBe(403);
  });

  it('a policy registered by name is resolved from the container', async () => {
    const run = (department: string) =>
      runSecure((api) => {
        seedPrincipal(api, principalWith(['department', department]));
        api.register((x) => addAuthorizationPolicy(x, 'employees-only', isEng));
        requirePolicy(api, 'employees-only');
      }, createSecureEvent());

    expect((await run('eng')).statusCode).toBe(200);
    expect((await run('sales')).statusCode).toBe(403);
  });

  it('no authenticated caller is Unauthorized', async () => {
    const response = await runSecure(
      (api) => requirePolicy(api, 'always', () => true),
      createSecureEvent(),
    );
    expect(response.statusCode).toBe(401);
  });
});

describe('requireAuthorization (resource-based)', () => {
  class OrderResource {
    constructor(readonly tenant: string) {}
  }

  class SameTenantAuthorizationHandler implements IAuthorizationHandler<OrderResource> {
    isAuthorizedAsync(principal: ClaimsPrincipal, resource: OrderResource): Promise<boolean> {
      return Promise.resolve(
        principal.hasClaim((c) => c.type === 'tenant' && c.value === resource.tenant),
      );
    }
  }

  const run = (tenant: string) =>
    runSecure((api) => {
      seedPrincipal(api, principalWith(['tenant', tenant]));
      api.register((x) =>
        x.addScopedFactory(
          IAuthorizationHandler,
          () => new SameTenantAuthorizationHandler() as IAuthorizationHandler<unknown>,
        ),
      );
      requireAuthorization(api, () => new OrderResource('acme'));
    }, createSecureEvent());

  it('a caller in the resource tenant passes through, otherwise Forbidden', async () => {
    expect((await run('acme')).statusCode).toBe(200);
    expect((await run('globex')).statusCode).toBe(403);
  });
});

describe('authentication + authorization composition', () => {
  class RoleValidator implements IBasicAuthCredentialValidator {
    constructor(private readonly role: string) {}

    validateAsync(username: string): Promise<ClaimsPrincipal | undefined> {
      return Promise.resolve(
        new ClaimsPrincipal(
          new ClaimsIdentity(
            [new Claim(ClaimTypes.name, username), new Claim('roles', this.role)],
            'Basic',
          ),
        ),
      );
    }
  }

  const authHeader = `Basic ${Buffer.from('svc:secret', 'utf8').toString('base64')}`;

  it('useBasicAuth sets the principal that requireRole then reads (admin -> 200)', async () => {
    const response = await runSecure((api) => {
      useBasicAuth(api, new RoleValidator('admin'));
      requireRole(api, 'admin');
    }, createSecureEvent(authHeader));
    expect(response.statusCode).toBe(200);
  });

  it('useBasicAuth authenticates but requireRole rejects the wrong role (reader -> 403)', async () => {
    const response = await runSecure((api) => {
      useBasicAuth(api, new RoleValidator('reader'));
      requireRole(api, 'admin');
    }, createSecureEvent(authHeader));
    expect(response.statusCode).toBe(403);
  });
});
