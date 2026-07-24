import { describe, expect, it } from 'vitest';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { ApiGatewayContext } from '@benzene/aws-lambda-api-gateway';
import { OAuth2BearerOptions, useOAuth2Bearer } from '@benzene/auth-oauth2';

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
});
