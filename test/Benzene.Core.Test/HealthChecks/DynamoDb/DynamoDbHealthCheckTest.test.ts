import { describe, expect, it } from 'vitest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { HealthCheckStatus } from '@benzenejs/health-checks-core';
import { DynamoDbHealthCheck } from '@benzenejs/health-checks-dynamodb';

/**
 * Ports Benzene.Test.HealthChecks.DynamoDb.DynamoDbHealthCheckTest: a non-destructive `DescribeTable`
 * reachability probe that is healthy on a 200 and unhealthy on any error, reporting the error's type
 * name (never its message). The `DynamoDBClient` is stubbed — only `send` is exercised.
 */

/** A stub DynamoDBClient whose `send` returns/throws whatever the test supplies. */
function stubDynamoDb(send: (command: unknown) => Promise<unknown>): DynamoDBClient {
  return { send } as unknown as DynamoDBClient;
}

describe('DynamoDbHealthCheck', () => {
  it('reports healthy on a 200 DescribeTable, with the Table dependency and status', async () => {
    let sentCommand: { input?: { TableName?: string } } | undefined;
    const check = new DynamoDbHealthCheck(
      'orders',
      stubDynamoDb((command) => {
        sentCommand = command as { input?: { TableName?: string } };
        return Promise.resolve({ $metadata: { httpStatusCode: 200 }, Table: { TableStatus: 'ACTIVE' } });
      }),
    );
    expect(check.type).toBe('DynamoDb');

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.type).toBe('DynamoDb');
    expect(sentCommand?.input?.TableName).toBe('orders');
    expect(result.data.TableName).toBe('orders');
    expect(result.data.TableStatus).toBe('ACTIVE');
    expect(result.dependencies).toEqual([{ kind: 'Table', name: 'orders' }]);
  });

  it('reports unhealthy when the client throws, with the error name and the Table dependency', async () => {
    const check = new DynamoDbHealthCheck(
      'orders',
      stubDynamoDb(() =>
        Promise.reject(Object.assign(new Error('no such table'), { name: 'ResourceNotFoundException' })),
      ),
    );

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.Error).toBe('ResourceNotFoundException');
    expect(result.data.TableName).toBe('orders');
    expect(result.dependencies).toEqual([{ kind: 'Table', name: 'orders' }]);
    expect(JSON.stringify(result.data)).not.toContain('no such table');
  });
});
