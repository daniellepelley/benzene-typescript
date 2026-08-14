import { describe, expect, it } from 'vitest';
import * as clientsAws from '@benzenejs/clients-aws';

/**
 * Verifies the `@benzenejs/clients-aws` umbrella (port of the references-only C# `Benzene.Clients.Aws`
 * meta-package) surfaces the public outbound-client entry points of each underlying AWS client package,
 * so a consumer can depend on the one umbrella instead of the five individual packages.
 */
describe('@benzenejs/clients-aws umbrella', () => {
  it('re-exports the outbound route extensions for the broker transports', () => {
    for (const name of ['useSqs', 'useSns', 'useEventBridge'] as const) {
      expect(typeof (clientsAws as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('re-exports the transport clients and reachability-check helpers', () => {
    for (const name of [
      'useSqsClient',
      'useSnsClient',
      'useEventBridgeClient',
      'addSnsHealthCheck',
      'addSqsHealthCheck',
    ] as const) {
      expect(typeof (clientsAws as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('re-exports the Lambda invoke client and the Step Functions client', () => {
    expect((clientsAws as Record<string, unknown>).AwsLambdaClient).toBeTypeOf('function');
    expect((clientsAws as Record<string, unknown>).StepFunctionsClient).toBeTypeOf('function');
  });
});
