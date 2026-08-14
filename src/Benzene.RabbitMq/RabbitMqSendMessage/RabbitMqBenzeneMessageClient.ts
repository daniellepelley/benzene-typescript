/** Port of Benzene.RabbitMq.RabbitMqSendMessage.RabbitMqBenzeneMessageClient. */
import {
  IBenzeneResultOf,
  ILogger,
  ISerializer,
  IServiceResolver,
  NullLogger,
  VoidResult,
} from '@benzenejs/abstractions';
import { BenzeneClientContext, IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { IBenzeneMessageClient } from '@benzenejs/clients';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import {
  MiddlewarePipelineBuilder,
  NullBenzeneServiceContainer,
  NullServiceResolver,
} from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { Channel } from 'amqplib';
import { RabbitMqConstants } from '../RabbitMqConstants';
import { RabbitMqContextConverter } from './RabbitMqContextConverter';
import { RabbitMqSendMessageContext } from './RabbitMqSendMessageContext';
import { useRabbitMqClient } from './Extensions';

/**
 * An {@link IBenzeneMessageClient} that publishes outbound messages to RabbitMQ, so business logic
 * depends only on the transport-agnostic client surface. Mirrors {@link KafkaBenzeneMessageClient}: a
 * message is converted to a {@link RabbitMqSendMessageContext} and run through a one-middleware publish
 * pipeline.
 *
 * The two C# constructors (channel / prebuilt pipeline) collapse into one that accepts either an amqplib
 * `Channel` (builds the default single-middleware pipeline) or an already-built
 * `IMiddlewarePipeline<RabbitMqSendMessageContext>` (for testing). When a prebuilt pipeline is supplied,
 * `mandatory` is ignored (it is already baked into the pipeline).
 */
export class RabbitMqBenzeneMessageClient implements IBenzeneMessageClient {
  // Shared across every send: a `JsonSerializer` caches resolved metadata per instance.
  private static readonly SharedSerializer: ISerializer = new JsonSerializer();

  private readonly middlewarePipeline: IMiddlewarePipeline<RabbitMqSendMessageContext>;

  /**
   * @param channelOrPipeline The RabbitMQ channel to publish on, or a prebuilt publish pipeline.
   * @param logger Logs a publish failure.
   * @param serviceResolver The resolver the publish pipeline runs in.
   * @param exchange The exchange to publish to (empty string for the default exchange).
   * @param mandatory Whether an unroutable message is returned rather than dropped (channel form only).
   * @param topicHeaderKey The message-property header the topic is written to (defaults to
   * {@link RabbitMqConstants.DefaultTopicHeader}).
   */
  constructor(
    channelOrPipeline: Channel | IMiddlewarePipeline<RabbitMqSendMessageContext>,
    private readonly logger: ILogger = NullLogger.instance,
    private readonly serviceResolver: IServiceResolver = new NullServiceResolver(),
    private readonly exchange = '',
    mandatory = false,
    private readonly topicHeaderKey: string = RabbitMqConstants.DefaultTopicHeader,
  ) {
    if (isMiddlewarePipeline(channelOrPipeline)) {
      this.middlewarePipeline = channelOrPipeline;
    } else {
      this.middlewarePipeline = useRabbitMqClient(
        new MiddlewarePipelineBuilder<RabbitMqSendMessageContext>(new NullBenzeneServiceContainer()),
        channelOrPipeline,
        mandatory,
      ).build();
    }
  }

  async sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    try {
      const converter = new RabbitMqContextConverter<TRequest>(
        RabbitMqBenzeneMessageClient.SharedSerializer,
        this.exchange,
        this.topicHeaderKey,
      );
      const context = await converter.createRequestAsync(
        new BenzeneClientContext<TRequest, VoidResult>(request),
      );

      await this.middlewarePipeline.handleAsync(context, this.serviceResolver);

      return context.published
        ? BenzeneResult.accepted<TResponse>()
        : BenzeneResult.unexpectedError<TResponse>();
    } catch (ex) {
      this.logger.logError(ex, `Sending message ${request.topic} failed`);
      return BenzeneResult.serviceUnavailable<TResponse>(ex instanceof Error ? ex.message : String(ex));
    }
  }

  dispose(): void {
    // Intentionally empty — the channel/connection lifetime is owned by the caller.
  }
}

function isMiddlewarePipeline(
  value: Channel | IMiddlewarePipeline<RabbitMqSendMessageContext>,
): value is IMiddlewarePipeline<RabbitMqSendMessageContext> {
  return typeof (value as IMiddlewarePipeline<RabbitMqSendMessageContext>).handleAsync === 'function';
}
