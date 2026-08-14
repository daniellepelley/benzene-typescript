/** Port of Benzene.HealthChecks.DynamoDb.Extensions. */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { addHealthCheckFactory, IHealthCheckBuilder } from '@benzenejs/health-checks-core';
import { DynamoDbHealthCheckFactory } from './DynamoDbHealthCheckFactory';

/**
 * Registers a {@link DynamoDbHealthCheck} for `tableName`, sending via the given `DynamoDBClient`.
 *
 * PORT DIVERGENCE: the C# `AddDynamoDbHealthCheck(tableName)` resolves `IAmazonDynamoDB` from DI; the
 * TypeScript port takes the `@aws-sdk/client-dynamodb` `DynamoDBClient` explicitly (there is no synthetic
 * DI token for the raw AWS SDK client), matching the `@benzenejs/clients-aws-*` siblings.
 */
export function addDynamoDbHealthCheck(
  builder: IHealthCheckBuilder,
  tableName: string,
  dynamoDb: DynamoDBClient,
): IHealthCheckBuilder {
  return addHealthCheckFactory(builder, new DynamoDbHealthCheckFactory(tableName, dynamoDb));
}
