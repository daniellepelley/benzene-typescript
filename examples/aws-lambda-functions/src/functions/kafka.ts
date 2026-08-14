/**
 * Kafka (Amazon MSK) function. Point an MSK / self-managed-Kafka event-source mapping at this module's
 * `handler`. The record's Kafka topic routes it; the base64 record value is the payload.
 *
 * Same unified `BenzeneStartUp` + `new AwsLambdaHost(StartUp).lambdaHandler` one-liner — only `useKafka` differs.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useKafka } from '@benzenejs/aws-lambda-kafka';
import { NotifyWarehouseHandler } from '../handlers';

class KafkaStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useKafka(aws, (kafka) => useMessageHandlers(kafka, NotifyWarehouseHandler)));
  }
}

export const handler = new AwsLambdaHost(KafkaStartUp).lambdaHandler;
