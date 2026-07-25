/** Port of Benzene.Clients.Aws.Lambda.IAwsLambdaClient. */
import { InvocationType } from '@aws-sdk/client-lambda';

/**
 * Represents a client for invoking AWS Lambda functions. `Amazon.Lambda.InvocationType` ->
 * `@aws-sdk/client-lambda`'s `InvocationType` (a `'Event' | 'RequestResponse' | 'DryRun'` union).
 */
export interface IAwsLambdaClient {
  /**
   * Invokes the given function with the given request.
   * @param request The request to serialize as the invocation payload.
   * @param functionName The name of the function to invoke.
   * @param invocationType Whether to invoke fire-and-forget (`Event`) or request/response.
   * @returns The deserialized response (`undefined` for an `Event` invocation, which returns nothing).
   */
  sendMessageAsync<TRequest, TResponse>(request: TRequest, functionName: string, invocationType: InvocationType): Promise<TResponse>;
}
