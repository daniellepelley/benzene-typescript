import { describe, expect, it } from 'vitest';
import { Claim, ClaimsIdentity, ClaimsPrincipal, ClaimTypes } from '@benzene/auth-core';
import { IBasicAuthCredentialValidator, useBasicAuth } from '@benzene/auth-basic';
import { createSecureEvent, findHeader, runSecure } from './authHost';

/**
 * Port of test/Benzene.Core.Test/Auth/BasicAuthTest.cs. The C# test hosts a real Kestrel pipeline and
 * sends `Authorization: Basic ...` over HTTP; here the same behaviors are exercised through the API
 * Gateway HTTP host (see authHost.ts). `GET /secure` is the protected downstream route.
 */

/** Records the username/password it saw and returns whatever `validate` decides. */
class RecordingValidator implements IBasicAuthCredentialValidator {
  seenUsername: string | undefined;
  seenPassword: string | undefined;
  validate: (username: string, password: string) => ClaimsPrincipal | undefined = () => undefined;

  validateAsync(username: string, password: string): Promise<ClaimsPrincipal | undefined> {
    this.seenUsername = username;
    this.seenPassword = password;
    return Promise.resolve(this.validate(username, password));
  }
}

/** `Authorization: Basic <base64(user:pass)>`. */
function basicHeader(userColonPass: string): string {
  return `Basic ${Buffer.from(userColonPass, 'utf8').toString('base64')}`;
}

function principalFor(username: string): ClaimsPrincipal {
  return new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.name, username)], 'Basic'));
}

describe('BasicAuth (via API Gateway host)', () => {
  it('missing Authorization header is Unauthorized with a challenge', async () => {
    const validator = new RecordingValidator();
    const response = await runSecure(
      (api) => useBasicAuth(api, validator, 'test-realm'),
      createSecureEvent(),
    );

    expect(response.statusCode).toBe(401);
    expect(findHeader(response.headers, 'WWW-Authenticate')).toBe('Basic realm="test-realm"');
  });

  it('malformed Base64 is Unauthorized with a challenge', async () => {
    const validator = new RecordingValidator();
    const response = await runSecure(
      (api) => useBasicAuth(api, validator),
      createSecureEvent('Basic not-valid-base64!!!'),
    );

    expect(response.statusCode).toBe(401);
    expect(findHeader(response.headers, 'WWW-Authenticate')).toBeDefined();
  });

  it('a colon in the password decodes and splits on the first colon only', async () => {
    const validator = new RecordingValidator();
    validator.validate = (u, p) => (u === 'bob' && p === 'pa:ss:word' ? principalFor(u) : undefined);

    const response = await runSecure(
      (api) => useBasicAuth(api, validator),
      createSecureEvent(basicHeader('bob:pa:ss:word')),
    );

    expect(response.statusCode).toBe(200);
    expect(validator.seenUsername).toBe('bob');
    expect(validator.seenPassword).toBe('pa:ss:word');
  });

  it('a validator returning undefined is Unauthorized with a challenge', async () => {
    const validator = new RecordingValidator();
    validator.validate = () => undefined;

    const response = await runSecure(
      (api) => useBasicAuth(api, validator),
      createSecureEvent(basicHeader('user:wrong-password')),
    );

    expect(response.statusCode).toBe(401);
    expect(findHeader(response.headers, 'WWW-Authenticate')).toBeDefined();
  });

  it('a validator returning a principal passes through to the handler', async () => {
    const validator = new RecordingValidator();
    validator.validate = (u) => principalFor(u);

    const response = await runSecure(
      (api) => useBasicAuth(api, validator),
      createSecureEvent(basicHeader('user:correct-password')),
    );

    expect(response.statusCode).toBe(200);
  });
});
