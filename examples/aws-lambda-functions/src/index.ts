/**
 * `@benzene-example/aws-lambda-functions` - one order domain (`src/handlers.ts`) hosted on five AWS Lambda
 * transports (`src/functions/*`). Each function module ships its own unified `BenzeneStartUp` and exports
 * the `handler` AWS invokes via the one-liner `new AwsLambdaHost(StartUp).lambdaHandler`; they are
 * re-exported here namespaced so the shared name doesn't clash. See `README.md`.
 */
export * from './handlers';

export * as apiGatewayFunction from './functions/apiGateway';
export * as sqsFunction from './functions/sqs';
export * as snsFunction from './functions/sns';
export * as eventBridgeFunction from './functions/eventBridge';
export * as kafkaFunction from './functions/kafka';
