/**
 * EventBridge function. Point an EventBridge rule at this module's `handler`. The event's `detail-type`
 * is the topic and `detail` is the payload; delivery is fire-and-forget.
 *
 * Same unified `BenzeneStartUp` + `new AwsLambdaHost(StartUp).lambdaHandler` one-liner — only `useEventBridge` differs.
 */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzene/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzene/aws-lambda-core';
import { useEventBridge } from '@benzene/aws-lambda-eventbridge';
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
