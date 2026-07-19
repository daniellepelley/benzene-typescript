import { Context } from 'aws-lambda';
import { ServiceIdentifier, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { BenzeneInvocation, useBenzeneInvocation as coreUseBenzeneInvocation } from '@benzene/core-middleware';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';

/**
 * Port of Benzene.Aws.Lambda.Core.BenzeneInvocationExtensions (the AWS Lambda implementation of
 * `IBenzeneInvocation`).
 */

/** The platform identifier reported by `IBenzeneInvocation.platform` on AWS Lambda. */
export const PlatformName = 'AwsLambda';

/**
 * The identifier the native Lambda execution `Context` is keyed under in the invocation feature bag.
 *
 * ADAPTATION: C# keys the feature by `typeof(ILambdaContext)` (from `Amazon.Lambda.Core`). TypeScript
 * erases types and `@types/aws-lambda` names the execution context `Context`, so this `ServiceToken`
 * (named `ILambdaContext` to match the C# key's identity) stands in as the feature key. Retrieve it
 * with `invocation.getFeature(ILambdaContext)`.
 */
export const ILambdaContext: ServiceToken<Context> = serviceToken<Context>('ILambdaContext');

/**
 * Adds middleware that exposes an `IBenzeneInvocation` for the duration of the invocation, with
 * `invocationId` set to the Lambda request ID and `getFeature(ILambdaContext)` returning the native
 * Lambda execution context.
 *
 * DIVERGENCE from C#: the C# overload guards a nullable `ILambdaContext` and falls back to a new GUID
 * for the invocation id. This port's `AwsEventStreamContext.lambdaContext` is non-nullable (an
 * established port decision — a Node handler always receives the runtime `Context`), so the feature is
 * always present and `awsRequestId` is read directly, with no null guard or GUID fallback.
 *
 * @param app The pipeline builder to add the invocation middleware to.
 * @returns The pipeline builder, for chaining.
 */
export function useBenzeneInvocation(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  return coreUseBenzeneInvocation(app, (_serviceResolver, context) => {
    const features = new Map<ServiceIdentifier<unknown>, unknown>([
      [ILambdaContext, context.lambdaContext],
    ]);
    return new BenzeneInvocation(context.lambdaContext.awsRequestId, PlatformName, features);
  });
}
