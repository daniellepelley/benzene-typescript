import { describe, expect, it } from 'vitest';
import { LocalAwsLambdaClientFactory } from '@benzene/clients-aws-lambda';

/**
 * Port of test/Benzene.Core.Test/Aws/Client/Lambda/LocalAwsLambdaClientFactoryTest.cs. An unknown profile
 * yields `undefined` (C# `null`) - here via the async credential-resolution validation (the JS provider is
 * lazy, so the factory resolves the profile up front and returns `undefined` when it can't be loaded).
 */
describe('LocalAwsLambdaClientFactory', () => {
  it('Create_UnknownProfile_ReturnsUndefined', async () => {
    const result = await LocalAwsLambdaClientFactory.create('some-profile-that-does-not-exist');

    expect(result).toBeUndefined();
  });
});
