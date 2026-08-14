/** Port of Benzene.Clients.Aws.Sns.SnsHealthCheck. */
import { GetTopicAttributesCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { awsErrorDetails } from './awsErrorDetails';

/**
 * Verifies connectivity to an SNS topic with a read-only `GetTopicAttributes` call — the SNS analogue
 * of `SqsHealthCheck`'s queue check, but non-side-effecting (it does not publish). A permission error
 * (e.g. missing `sns:GetTopicAttributes`) is reported as a **persistent** failure — it surfaces as
 * unhealthy even for an auto-wired dependency check rather than being softened to a warning, because a
 * missing permission is a deterministic misconfiguration that won't self-heal. The SDK error name +
 * HTTP status go into `data`, never the error message.
 */
export class SnsHealthCheck implements IHealthCheck {
  readonly type = 'Sns';

  /**
   * @param topicArn The ARN of the topic to check.
   * @param sns The `@aws-sdk/client-sns` client used to read the topic's attributes.
   */
  constructor(
    private readonly topicArn: string,
    private readonly sns: SNSClient,
  ) {}

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Topic', this.topicArn)];
    try {
      const response = await this.sns.send(new GetTopicAttributesCommand({ TopicArn: this.topicArn }));
      const statusCode = response.$metadata.httpStatusCode;
      const ok = statusCode === undefined || statusCode === 200;
      return HealthCheckResult.createInstance(ok, this.type, { TopicArn: this.topicArn }, dependencies);
    } catch (error) {
      const { errorCode, statusCode } = awsErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: { TopicArn: this.topicArn },
        requiredPermission: 'sns:GetTopicAttributes',
      });
    }
  }
}
