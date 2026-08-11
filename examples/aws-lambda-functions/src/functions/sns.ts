/**
 * SNS function. Subscribe this module's `handler` to an SNS topic. The notification's `topic` message
 * attribute routes it; SNS delivery is fire-and-forget.
 *
 * Same unified `BenzeneStartUp` + `new AwsLambdaHost(StartUp).lambdaHandler` one-liner — only `useSns` differs.
 */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzene/aws-lambda-core';
import { useSns } from '@benzene/aws-lambda-sns';
import { NotifyWarehouseHandler } from '../handlers';

class SnsStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useSns(aws, (sns) => useMessageHandlers(sns, NotifyWarehouseHandler)));
  }
}

export const handler = new AwsLambdaHost(SnsStartUp).lambdaHandler;
