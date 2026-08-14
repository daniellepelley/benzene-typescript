/**
 * EventBridge function. Point an EventBridge rule at this module's `handler`. The event's `detail-type`
 * is the topic and `detail` is the payload; delivery is fire-and-forget.
 *
 * Same unified `BenzeneStartUp` + `new AwsLambdaHost(StartUp).lambdaHandler` one-liner — only `useEventBridge` differs.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useEventBridge } from '@benzenejs/aws-lambda-eventbridge';
import { NotifyWarehouseHandler } from '../handlers';

class EventBridgeStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useEventBridge(aws, (eb) => useMessageHandlers(eb, NotifyWarehouseHandler)));
  }
}

export const handler = new AwsLambdaHost(EventBridgeStartUp).lambdaHandler;
