/** Port of Benzene.HealthChecks.DynamoDb.DynamoDbHealthCheck. */
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  HealthCheckDependency,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzene/health-checks-core';

/**
 * Verifies a DynamoDB table is reachable with a read-only `DescribeTable` call. Non-destructive
 * (metadata only); healthy on a 200 response, unhealthy on any error.
 *
 * PORTING NOTE: `IAmazonDynamoDB.DescribeTableAsync(tableName)` → `@aws-sdk/client-dynamodb`'s
 * `DynamoDBClient.send(new DescribeTableCommand({ TableName }))`; `response.HttpStatusCode` →
 * `response.$metadata.httpStatusCode`.
 */
export class DynamoDbHealthCheck implements IHealthCheck {
  constructor(
    private readonly tableName: string,
    private readonly dynamoDb: DynamoDBClient,
  ) {}

  get type(): string {
    return 'DynamoDb';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Table', this.tableName)];

    try {
      const response = await this.dynamoDb.send(new DescribeTableCommand({ TableName: this.tableName }));
      const status = response.Table?.TableStatus;
      const ok = response.$metadata.httpStatusCode === 200;

      return HealthCheckResult.createInstance(
        ok,
        this.type,
        { TableName: this.tableName, TableStatus: status ?? 'unknown' },
        dependencies,
      );
    } catch (error) {
      // Expected failures (table missing, no connectivity) are a failed result, not a throw; report
      // the error type/name, never its message.
      return HealthCheckResult.createInstance(
        false,
        this.type,
        { TableName: this.tableName, Error: error instanceof Error ? error.name : String(error) },
        dependencies,
      );
    }
  }
}
