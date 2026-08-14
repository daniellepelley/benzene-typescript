/**
 * SQS function. Point an SQS event-source mapping at this module's `handler`. Each record's `topic`
 * message attribute routes it to the matching handler; partial-batch failures are reported back to SQS.
 *
 * Same unified `BenzeneStartUp` + `new AwsLambdaHost(StartUp).lambdaHandler` one-liner as every other
 * transport here — only the `useSqs` line differs.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useSqs } from '@benzenejs/aws-lambda-sqs';
import { NotifyWarehouseHandler } from '../handlers';

class SqsStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useSqs(aws, (sqs) => useMessageHandlers(sqs, NotifyWarehouseHandler)));
  }
}

export const handler = new AwsLambdaHost(SqsStartUp).lambdaHandler;
