/**
 * `@benzene-example/aws-lambda-functions` - one order domain (`src/handlers.ts`) hosted on five AWS Lambda
 * transports (`src/functions/*`). Each function module exports the `handler` AWS invokes; they are
 * re-exported here namespaced so the shared name doesn't clash. See `README.md`.
 */
export * from './handlers';
export { lambdaHandler } from './lambda';

export * as apiGatewayFunction from './functions/apiGateway';
export * as sqsFunction from './functions/sqs';
export * as snsFunction from './functions/sns';
export * as eventBridgeFunction from './functions/eventBridge';
export * as kafkaFunction from './functions/kafka';
