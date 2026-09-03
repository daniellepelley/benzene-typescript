import { describe, expect, it } from 'vitest';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { ApiGatewayContext } from '@benzenejs/aws-lambda-api-gateway';
import { OAuth2BearerOptions, useOAuth2Bearer } from '@benzenejs/auth-oauth2';

/**
 * Port of test/Benzene.Core.Test/Auth/OAuth2BearerOptionsValidationTest.cs. `OAuth2BearerOptions.validate`
 * runs at pipeline wire-up time (via `useOAuth2Bearer`), not on the first request - a misconfigured
 * pipeline must fail fast. Exercised through the public `useOAuth2Bearer` entry point.
 */

function validOptions(): OAuth2BearerOptions {
  const options = new OAuth2BearerOptions();
  options.jwksUri = 'https://issuer.example.com/.well-known/jwks.json';
  options.validIssuers = ['https://issuer.example.com'];
  options.validAudiences = ['my-api'];
  options.validAlgorithms = ['RS256'];
  return options;
}

function createPipelineBuilder(): MiddlewarePipelineBuilder<ApiGatewayContext> {
  return new MiddlewarePipelineBuilder<ApiGatewayContext>(new DefaultBenzeneServiceContainer());
}

describe('OAuth2BearerOptions validation (via useOAuth2Bearer)', () => {
  it('throws when both authority and jwksUri are set', () => {
    const options = validOptions();
    options.authority = 'https://issuer.example.com/.well-known/openid-configuration';

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow();
  });

  it('throws when neither authority nor jwksUri is set', () => {
    const options = validOptions();
    options.jwksUri = undefined;

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow();
  });

  it('throws when validIssuers is empty', () => {
    const options = validOptions();
    options.validIssuers = [];

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow();
  });

  it('throws when validAudiences is empty', () => {
    const options = validOptions();
    options.validAudiences = [];

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow();
  });

  it('throws when validAlgorithms is empty', () => {
    // The one that directly guards against RFC 8725 §3.1 algorithm confusion.
    const options = validOptions();
    options.validAlgorithms = [];

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow();
  });

  it('does not throw for valid options', () => {
    expect(() => useOAuth2Bearer(createPipelineBuilder(), validOptions())).not.toThrow();
  });

  // --- #174/#244: per-entry allowlist validation. Prior to this fix only the EMPTY-list case above
  // was caught; any of the entry shapes below passed construction (jose would refuse "none" at
  // verify time, but fail-fast-at-wire-up is the ported rule). Mirrors the .NET
  // MeshOidcOptionsValidateTest / OAuth2BearerOptionsValidationTest matrix. ------------------------

  it.each([
    ['undefined', undefined as unknown as string],
    ['empty', ''],
    ['whitespace', '   '],
  ])('throws when validAlgorithms contains a useless entry (%s)', (_label, badEntry) => {
    const options = validOptions();
    options.validAlgorithms = ['RS256', badEntry];

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow(/null\/empty\/whitespace/);
  });

  it('throws when validAlgorithms contains "none"', () => {
    // RFC 8725 §3.1's canonical algorithm-confusion attack - "alg": "none" must never be a
    // wire-up-accepted allowlist entry, not just something the token itself can't claim its way past.
    const options = validOptions();
    options.validAlgorithms = ['none'];

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow(/none/);
  });

  it('throws when validAlgorithms contains "none" among real entries', () => {
    const options = validOptions();
    options.validAlgorithms = ['RS256', 'none'];

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow(/none/);
  });

  it('rejects "none" case-insensitively', () => {
    const options = validOptions();
    options.validAlgorithms = ['NONE'];

    expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow();
  });

  it.each(['RS257', 'rot13', 'HMAC-SHA256'])(
    'throws when validAlgorithms contains the unrecognized name %s',
    (badAlgorithm) => {
      const options = validOptions();
      options.validAlgorithms = [badAlgorithm];

      expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).toThrow(/not a recognized/);
    },
  );

  it.each(['RS256', 'HS256', 'RS384', 'ES512', 'PS256', 'EdDSA'])(
    'does not throw for the recognized algorithm %s',
    (goodAlgorithm) => {
      const options = validOptions();
      options.validAlgorithms = [goodAlgorithm];

      expect(() => useOAuth2Bearer(createPipelineBuilder(), options)).not.toThrow();
    },
  );
});
