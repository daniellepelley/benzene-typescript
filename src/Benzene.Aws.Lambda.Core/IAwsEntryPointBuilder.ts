import { IAwsLambdaEntryPoint } from './IAwsLambdaEntryPoint';

/**
 * Port of Benzene.Aws.Lambda.Core.IAwsEntryPointBuilder.
 *
 * Abstraction for types that build an `IAwsLambdaEntryPoint` (e.g. `InlineAwsLambdaStartUp`).
 */
export interface IAwsEntryPointBuilder {
  /** Builds the configured Lambda entry point, ready to handle invocations. */
  build(): IAwsLambdaEntryPoint;
}
