/** Port of Benzene.Clients.Aws.Sqs.SqsHealthCheck. */
import {
  GetQueueAttributesCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { BenzeneTopic } from '@benzenejs/abstractions';
import {
  HealthCheckDependency,
  HealthCheckError,
  HealthCheckMode,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { awsErrorDetails } from './awsErrorDetails';
import { OutboundSqsContextConverter } from './OutboundSqsContextConverter';

/** The topic value a ping message carries in active mode. */
const pingTopic = BenzeneTopic.ping;

/**
 * Verifies connectivity to an SQS queue. In the default `reachability` mode this is a
 * **non-destructive** read-only `GetQueueAttributes` call; in `active` mode it sends a real `ping`
 * message (side-effecting — the queue's consumer must recognise and drop it).
 *
 * The reachability check proves the queue exists, is reachable, and the credentials can read it
 * (`sqs:GetQueueAttributes`) — it does **not** prove a send would succeed (`sqs:SendMessage` is a
 * different permission). Failures are classified via the shared `HealthCheckError` policy: an
 * authorization denial is a persistent failure, anything else transient; the SDK error name + HTTP
 * status go into `data`, never the error message.
 */
export class SqsHealthCheck implements IHealthCheck {
  /**
   * @param queueUrl The URL of the queue to check.
   * @param amazonSqs The `@aws-sdk/client-sqs` client used to run the check.
   * @param mode Reachability (default, read-only) or Active (sends a ping — side-effecting).
   * @param topicAttributeKey Active mode only: the message attribute the ping topic is written to.
   * Defaults to `OutboundSqsContextConverter.DefaultTopicAttribute` — pass the same key the queue's
   * consumer routes on so the ping is routable there too.
   */
  constructor(
    private readonly queueUrl: string,
    private readonly amazonSqs: SQSClient,
    private readonly mode: HealthCheckMode = HealthCheckMode.reachability,
    private readonly topicAttributeKey: string = OutboundSqsContextConverter.DefaultTopicAttribute,
  ) {}

  /** The check's identifier: `"Sqs"` in reachability mode, `"Sqs.Active"` in active mode. */
  get type(): string {
    return this.mode === HealthCheckMode.active ? 'Sqs.Active' : 'Sqs';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Queue', this.queueUrl)];
    try {
      const response =
        this.mode === HealthCheckMode.active
          ? await this.amazonSqs.send(
              new SendMessageCommand({
                QueueUrl: this.queueUrl,
                MessageBody: '{}',
                MessageAttributes: {
                  [this.topicAttributeKey]: { DataType: 'String', StringValue: pingTopic },
                },
              }),
            )
          : await this.amazonSqs.send(
              new GetQueueAttributesCommand({ QueueUrl: this.queueUrl, AttributeNames: ['QueueArn'] }),
            );

      const statusCode = response.$metadata.httpStatusCode;
      const ok = statusCode === undefined || statusCode === 200;
      return HealthCheckResult.createInstance(
        ok,
        this.type,
        ok
          ? { QueueUrl: this.queueUrl }
          : { QueueUrl: this.queueUrl, Error: `Returned a status of ${statusCode}` },
        dependencies,
      );
    } catch (error) {
      // Expected failures (queue missing, no connectivity, no permission) are a classified result, not
      // a throw. An authorization denial (401/403 or a known auth error code) is a persistent failure.
      const { errorCode, statusCode } = awsErrorDetails(error);
      return HealthCheckError.classify(this.type, error, dependencies, {
        errorCode,
        statusCode,
        data: { QueueUrl: this.queueUrl },
        requiredPermission: this.mode === HealthCheckMode.active ? 'sqs:SendMessage' : 'sqs:GetQueueAttributes',
      });
    }
  }
}
