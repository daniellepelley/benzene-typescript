/** Port of Benzene.Clients.Aws.StepFunctions.StepFunctionsHealthCheck. */
import { DescribeStateMachineCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckMode,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { awsErrorDetails } from './awsErrorDetails';

/**
 * Verifies connectivity to a Step Functions state machine. In the default `reachability` mode this is a
 * **non-destructive** read-only `DescribeStateMachine` call; in `active` mode it starts a real execution
 * (side-effecting). Failures are classified via the shared `HealthCheckError` policy (an authorization
 * denial is persistent, anything else transient); the SDK error name + HTTP status go into `data`, never
 * the error message.
 */
export class StepFunctionsHealthCheck implements IHealthCheck {
  constructor(
    private readonly stateMachineArn: string,
    private readonly amazonStepFunctions: SFNClient,
    private readonly mode: HealthCheckMode = HealthCheckMode.reachability,
  ) {}

  /** The check's identifier: `"StepFunctions"` in reachability mode, `"StepFunctions.Active"` in active mode. */
  get type(): string {
    return this.mode === HealthCheckMode.active ? 'StepFunctions.Active' : 'StepFunctions';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('StateMachine', this.stateMachineArn)];
    try {
      const response =
        this.mode === HealthCheckMode.active
          ? await this.amazonStepFunctions.send(
              new StartExecutionCommand({ stateMachineArn: this.stateMachineArn, input: '{}' }),
            )
          : await this.amazonStepFunctions.send(
              new DescribeStateMachineCommand({ stateMachineArn: this.stateMachineArn }),
            );

      const statusCode = response.$metadata.httpStatusCode;
      const ok = statusCode === undefined || statusCode === 200;
      return HealthCheckResult.createInstance(
        ok,
        this.type,
        ok
          ? { StateMachineArn: this.stateMachineArn }
          : { StateMachineArn: this.stateMachineArn, Error: `Returned a status of ${statusCode}` },
        dependencies,
      );
    } catch (error) {
      const { errorCode, statusCode } = awsErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: { StateMachineArn: this.stateMachineArn },
        requiredPermission:
          this.mode === HealthCheckMode.active ? 'states:StartExecution' : 'states:DescribeStateMachine',
      });
    }
  }
}
