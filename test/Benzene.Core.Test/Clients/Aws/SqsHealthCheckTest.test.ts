import { describe, expect, it } from 'vitest';
import { SQSClient } from '@aws-sdk/client-sqs';
import { HealthCheckMode, HealthCheckStatus } from '@benzenejs/health-checks-core';
import { SqsHealthCheck } from '@benzenejs/clients-aws-sqs';

/**
 * Ports Benzene.Clients.Aws.Sqs.SqsHealthCheck: a non-destructive `GetQueueAttributes` reachability
 * probe that classifies failures via the shared policy (auth denial -> persistent failed) and never
 * surfaces the error message. The `SQSClient` is stubbed — only `send` is exercised.
 */

const queueUrl = 'https://sqs.eu-west-1.amazonaws.com/123456789012/orders';

/** A stub SQSClient whose `send` returns/throws whatever the test supplies. */
function stubSqs(send: (command: unknown) => Promise<unknown>): SQSClient {
  return { send } as unknown as SQSClient;
}

describe('SqsHealthCheck', () => {
  it('reports healthy on a 200 GetQueueAttributes, with the Queue dependency', async () => {
    const check = new SqsHealthCheck(queueUrl, stubSqs(() => Promise.resolve({ $metadata: { httpStatusCode: 200 } })));
    expect(check.type).toBe('Sqs');

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.data.QueueUrl).toBe(queueUrl);
    expect(result.dependencies).toEqual([{ kind: 'Queue', name: queueUrl }]);
  });

  it('classifies an access-denied (403) as a persistent failure without leaking the message', async () => {
    const check = new SqsHealthCheck(
      queueUrl,
      stubSqs(() => Promise.reject(Object.assign(new Error('secret arn leaked'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }))),
    );

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(true);
    expect(result.data.ErrorCode).toBe('AccessDenied');
    expect(result.data.StatusCode).toBe(403);
    expect(result.data.RequiredPermission).toBe('sqs:GetQueueAttributes');
    expect(JSON.stringify(result.data)).not.toContain('secret arn leaked');
  });

  it('classifies a non-authorization error (throttling) as a transient failure', async () => {
    const check = new SqsHealthCheck(
      queueUrl,
      stubSqs(() => Promise.reject(Object.assign(new Error('slow down'), { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 } }))),
    );

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(false);
  });

  it('active mode sends a ping and reports under the Sqs.Active type', async () => {
    let sentCommand: { input?: { MessageBody?: string } } | undefined;
    const check = new SqsHealthCheck(
      queueUrl,
      stubSqs((command) => {
        sentCommand = command as { input?: { MessageBody?: string } };
        return Promise.resolve({ $metadata: { httpStatusCode: 200 } });
      }),
      HealthCheckMode.active,
    );
    expect(check.type).toBe('Sqs.Active');

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(sentCommand?.input?.MessageBody).toBe('{}');
  });
});
