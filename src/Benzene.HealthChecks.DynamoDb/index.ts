/**
 * Port of Benzene.HealthChecks.DynamoDb — a non-destructive DynamoDB table reachability health check.
 *
 * `addDynamoDbHealthCheck(builder, tableName, dynamoDb)` registers a check that verifies the table is
 * reachable with a read-only `DescribeTable` call (healthy on a 200, unhealthy on any error), over a
 * caller-supplied `@aws-sdk/client-dynamodb` `DynamoDBClient`.
 */
export * from './DynamoDbHealthCheck';
export * from './DynamoDbHealthCheckFactory';
export * from './Extensions';
