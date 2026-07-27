/** Port of Benzene.Clients.Aws.Lambda.AwsLambdaHealthCheck (reachability mode). */
import { GetFunctionConfigurationCommand, LambdaClient } from '@aws-sdk/client-lambda';
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzene/health-checks-core';
import { awsErrorDetails } from './awsErrorDetails';

/**
 * Verifies connectivity to a Lambda function with a **non-destructive** read-only
 * `GetFunctionConfiguration` call. Proves the function exists, is reachable, and the credentials can read
 * it (`lambda:GetFunctionConfiguration`) — not that an invoke would succeed (`lambda:InvokeFunction` is a
 * different permission). Failures are classified via the shared `HealthCheckError` policy (auth denial ->
 * persistent failure); the SDK error name + HTTP status go into `data`, never the error message.
 *
 * PORT NOTE: only reachability mode is ported. .NET's `HealthCheckMode.Active` (a real ping *invoke*)
 * depends on the high-level `AwsLambdaBenzeneMessageClient`, which is itself deferred in this port (see
 * the package README); it can be added when that client lands.
 */
export class AwsLambdaHealthCheck implements IHealthCheck {
  readonly type = 'Lambda';

  /**
   * @param lambdaName The name of the Lambda function to check.
   * @param amazonLambda The `@aws-sdk/client-lambda` client used to run the check.
   */
  constructor(
    private readonly lambdaName: string,
    private readonly amazonLambda: LambdaClient,
  ) {}

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Lambda', this.lambdaName)];
    try {
      const response = await this.amazonLambda.send(
        new GetFunctionConfigurationCommand({ FunctionName: this.lambdaName }),
      );
      const statusCode = response.$metadata.httpStatusCode;
      const ok = statusCode === undefined || statusCode === 200;
      return HealthCheckResult.createInstance(
        ok,
        this.type,
        ok ? { Lambda: this.lambdaName } : { Lambda: this.lambdaName, Status: statusCode },
        dependencies,
      );
    } catch (error) {
      const { errorCode, statusCode } = awsErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: { Lambda: this.lambdaName },
        requiredPermission: 'lambda:GetFunctionConfiguration',
      });
    }
  }
}
