/** Port of Benzene.Clients.Aws.EventBridge.EventBridgeHealthCheck. */
import { DescribeEventBusCommand, EventBridgeClient } from '@aws-sdk/client-eventbridge';
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { awsErrorDetails } from './awsErrorDetails';

/** The name AWS uses for the account's default event bus. */
export const defaultEventBusName = 'default';

/**
 * Verifies an EventBridge event bus is reachable with a read-only `DescribeEventBus` call — the
 * EventBridge analogue of `SqsHealthCheck`/`SnsHealthCheck`, non-side-effecting (it does not `PutEvents`,
 * which would fire real rules/targets). Proves the bus exists, is reachable, and the credentials can read
 * it (`events:DescribeEventBus`) — not that a publish would succeed. An authorization/permission failure
 * is a **persistent** failure (some SDKs surface access-denied as HTTP 400, which `HealthCheckError`
 * detects by error code). The SDK error name + HTTP status go into `data`, never the error message.
 */
export class EventBridgeHealthCheck implements IHealthCheck {
  readonly type = 'EventBridge';
  private readonly eventBusName: string;

  /**
   * @param eventBridge The `@aws-sdk/client-eventbridge` client used to run the check.
   * @param eventBusName The event bus to check; empty/undefined targets the account's default bus.
   */
  constructor(
    private readonly eventBridge: EventBridgeClient,
    eventBusName?: string,
  ) {
    this.eventBusName = eventBusName === undefined || eventBusName === '' ? defaultEventBusName : eventBusName;
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('EventBus', this.eventBusName)];
    try {
      const response = await this.eventBridge.send(new DescribeEventBusCommand({ Name: this.eventBusName }));
      const statusCode = response.$metadata.httpStatusCode;
      const ok = statusCode === undefined || statusCode === 200;
      return HealthCheckResult.createInstance(ok, this.type, { EventBus: this.eventBusName }, dependencies);
    } catch (error) {
      const { errorCode, statusCode } = awsErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: { EventBus: this.eventBusName },
        requiredPermission: 'events:DescribeEventBus',
      });
    }
  }
}
