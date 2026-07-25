/** Port of Benzene.Clients.Aws.Lambda.LocalAwsLambdaClientFactory. */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromIni } from '@aws-sdk/credential-providers';

/**
 * Creates a `LambdaClient` from a local AWS credentials profile, for local development and testing.
 *
 * `CredentialProfileStoreChain` -> `@aws-sdk/credential-providers`'s `fromIni`. Divergence: C#'s
 * `TryGetAWSCredentials` resolves the profile synchronously and returns `null` on a miss, but the JS
 * credential provider resolves lazily, so this is `async` and resolves the credentials up front to validate
 * the profile - returning `undefined` (C# `null`) when the profile can't be loaded.
 */
export const LocalAwsLambdaClientFactory = {
  /**
   * Creates a Lambda client using credentials from the given local AWS profile.
   * @param profileName The name of the local AWS credentials profile to use.
   * @returns The created Lambda client, or `undefined` if the profile could not be found.
   */
  async create(profileName: string): Promise<LambdaClient | undefined> {
    const credentials = fromIni({ profile: profileName });
    try {
      // Resolve once to validate the profile exists (the JS provider is lazy); reuse the resolved provider.
      await credentials();
    } catch {
      return undefined;
    }
    return new LambdaClient({ credentials });
  },
};
