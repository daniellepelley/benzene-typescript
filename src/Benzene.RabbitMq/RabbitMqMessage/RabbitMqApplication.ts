/** Port of Benzene.RabbitMq.RabbitMqMessage.RabbitMqApplication. */
import { ConsumeMessage } from 'amqplib';
import { IMessageResult, TransportNames } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline } from '@benzenejs/core-message-handlers';
import { MiddlewareApplicationWithResult } from '@benzenejs/core-middleware';
import { RabbitMqContext } from './RabbitMqContext';

/**
 * Processes a single RabbitMQ delivery by mapping it to a {@link RabbitMqContext} and running it through
 * the middleware pipeline in its own service scope, tagging the transport as `"rabbitmq"` for the
 * duration. Returns the handler's recorded result (or `undefined` if nothing set one), which
 * {@link RabbitMqWorker} reads to support `RabbitMqAckMode.Explicit`.
 *
 * Uses the ported `MiddlewareApplicationWithResult` base (C# `MiddlewareApplication<BasicDeliverEventArgs,
 * RabbitMqContext, IBenzeneResult?>`), wrapping the pipeline in `TransportMiddlewarePipeline("rabbitmq")`.
 * Mirrors `EventHubConsumerApplication`/`KafkaApplication`.
 */
export class RabbitMqApplication extends MiddlewareApplicationWithResult<
  ConsumeMessage,
  RabbitMqContext,
  IMessageResult | undefined
> {
  constructor(pipeline: IMiddlewarePipeline<RabbitMqContext>) {
    super(
      new TransportMiddlewarePipeline<RabbitMqContext>(TransportNames.RabbitMq, pipeline),
      RabbitMqContext.createInstance,
      (context) => context.messageResult,
    );
  }
}
