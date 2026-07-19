import { describe, expect, it } from 'vitest';
import { ServiceIdentifier, serviceToken } from '@benzene/abstractions';
import { IBenzeneInvocation } from '@benzene/abstractions-middleware';
import { BenzeneInvocation } from '@benzene/core-middleware';

/**
 * Port of the BenzeneInvocation scenarios: `invocationId`/`platform` are exposed, and `getFeature`
 * returns a registered feature by its identifier and `undefined` when absent.
 */

interface ILambdaContext {
  awsRequestId: string;
}
const ILambdaContext: ServiceIdentifier<ILambdaContext> =
  serviceToken<ILambdaContext>('ILambdaContext');

interface IOtherFeature {
  value: string;
}
const IOtherFeature: ServiceIdentifier<IOtherFeature> = serviceToken<IOtherFeature>('IOtherFeature');

describe('BenzeneInvocationTest', () => {
  it('exposes invocationId and platform', () => {
    const invocation: IBenzeneInvocation = new BenzeneInvocation(
      'request-123',
      'AwsLambda',
      new Map(),
    );

    expect(invocation.invocationId).toBe('request-123');
    expect(invocation.platform).toBe('AwsLambda');
  });

  it('getFeature returns a registered feature by identifier', () => {
    const lambdaContext: ILambdaContext = { awsRequestId: 'request-123' };
    const features = new Map<ServiceIdentifier<unknown>, unknown>([[ILambdaContext, lambdaContext]]);

    const invocation = new BenzeneInvocation('request-123', 'AwsLambda', features);

    expect(invocation.getFeature(ILambdaContext)).toBe(lambdaContext);
  });

  it('getFeature returns undefined when the feature is absent', () => {
    const features = new Map<ServiceIdentifier<unknown>, unknown>([
      [ILambdaContext, { awsRequestId: 'request-123' }],
    ]);

    const invocation = new BenzeneInvocation('request-123', 'AwsLambda', features);

    expect(invocation.getFeature(IOtherFeature)).toBeUndefined();
  });
});
