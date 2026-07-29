/** Port of Benzene.HealthChecks.DynamoDb.DynamoDbHealthCheckFactory. */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { IServiceResolver } from '@benzene/abstractions';
import { IHealthCheck, IHealthCheckFactory } from '@benzene/health-checks-core';
import { DynamoDbHealthCheck } from './DynamoDbHealthCheck';

/**
 * Builds a {@link DynamoDbHealthCheck} for a fixed table.
 *
 * PORT DIVERGENCE: the C# factory resolves `IAmazonDynamoDB` from the container in `Create`; the
 * TypeScript port has no DI token for the raw AWS SDK client (matching the `@benzene/clients-aws-*`
 * convention), so the `DynamoDBClient` is supplied to the factory directly and `create`'s resolver is
 * unused.
 */
export class DynamoDbHealthCheckFactory implements IHealthCheckFactory {
  constructor(
    private readonly tableName: string,
    private readonly dynamoDb: DynamoDBClient,
  ) {}

  create(_resolver: IServiceResolver): IHealthCheck {
    return new DynamoDbHealthCheck(this.tableName, this.dynamoDb);
  }
}
