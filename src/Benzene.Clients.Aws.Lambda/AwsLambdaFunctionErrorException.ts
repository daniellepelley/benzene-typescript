/** Port of Benzene.Clients.Aws.Lambda.AwsLambdaFunctionErrorException. */

/**
 * Thrown when a `RequestResponse` invocation returns with `InvokeResponse.FunctionError` set - i.e. the
 * target function threw. AWS returns HTTP 200 in that case with an error object
 * (`errorMessage`/`errorType`/`stackTrace`) as the payload rather than the function's normal output, so
 * treating the payload as the expected response would silently mis-deserialize a failure into a success.
 * Raising this instead lets the caller surface it as a failure result.
 */
export class AwsLambdaFunctionErrorException extends Error {
  /**
   * @param functionName The invoked function's name.
   * @param functionError The `FunctionError` value (`"Handled"`/`"Unhandled"`).
   * @param errorPayload The raw error payload the function returned.
   */
  constructor(
    readonly functionName: string,
    readonly functionError: string,
    readonly errorPayload: string,
  ) {
    super(`Lambda function ${functionName} reported a ${functionError} error: ${errorPayload}`);
    this.name = 'AwsLambdaFunctionErrorException';
  }
}
