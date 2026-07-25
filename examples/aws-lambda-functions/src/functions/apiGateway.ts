/**
 * API Gateway (HTTP) function. Point an API Gateway REST API / a Lambda `POST /orders` at this module's
 * `handler`. This is the synchronous, request/response transport - it returns the order confirmation.
 */
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { lambdaHandler } from '../lambda';
import { PlaceOrderHandler } from '../handlers';

export const handler = lambdaHandler((app) =>
  useApiGateway(app, (api) => useMessageHandlers(api, PlaceOrderHandler)),
);
