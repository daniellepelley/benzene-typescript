/**
 * API Gateway (HTTP) function. Point an API Gateway REST API / a Lambda `POST /orders` at this module's
 * `handler`. This is the synchronous, request/response transport - it returns the order confirmation.
 *
 * The composition root is the unified `BenzeneStartUp` — the SAME shape on every cloud — booted by the
 * one-liner `new AwsLambdaHost(StartUp).lambdaHandler`. Only the `useApiGateway` line is transport-specific.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { PlaceOrderHandler } from '../handlers';

class ApiGatewayStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, PlaceOrderHandler)));
  }
}

export const handler = new AwsLambdaHost(ApiGatewayStartUp).lambdaHandler;
