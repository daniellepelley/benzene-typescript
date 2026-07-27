/** Port of Benzene.RabbitMq.RabbitMqWorker. */
import { Channel, ChannelModel, ConsumeMessage } from 'amqplib';
import { ILogger, ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IBenzeneWorker } from '@benzene/abstractions-middleware';
import { BoundedConcurrentDispatcher } from '@benzene/self-host';
import { RabbitMqAckMode } from './RabbitMqAckMode';
import { RabbitMqConfig, withRabbitMqConfigDefaults } from './RabbitMqConfig';
import { IRabbitMqConnectionFactory } from './IRabbitMqConnectionFactory';
import { RabbitMqApplication } from './RabbitMqMessage/RabbitMqApplication';

/**
 * A long-running worker that consumes a RabbitMQ queue via `amqplib` and dispatches each delivery through
 * a Benzene middleware pipeline — for `@benzene/self-host`, not a cloud trigger. The RabbitMQ counterpart
 * of {@link BenzeneKafkaWorker} and {@link BenzeneServiceBusWorker}.
 *
 * Deliveries are pushed by amqplib's `channel.consume` callback (not hand-polled like Kafka) and fanned
 * out through a {@link BoundedConcurrentDispatcher} so up to {@link RabbitMqConfig.concurrentRequests}
 * handlers run at once; the consumer's prefetch (QoS) count bounds how many unacknowledged deliveries the
 * broker sends. Under {@link RabbitMqAckMode.Explicit} (the default) each delivery is `ack`ed on handler
 * success and `nack`ed — requeued or dead-lettered per {@link RabbitMqConfig.requeueOnFailure} — on a
 * failure result or a thrown exception, so nothing is settled until its handler has actually run.
 * `startAsync` opens the connection/channel and starts consuming, then returns; `stopAsync` cancels the
 * consumer, drains in-flight handlers (up to {@link RabbitMqConfig.drainTimeoutMs}), and closes the
 * channel and connection.
 *
 * PORTING NOTES:
 * - .NET consumes with an `AsyncEventingBasicConsumer` and settles via `BasicAck`/`BasicNack`; amqplib's
 *   `channel.consume(queue, onMessage, { noAck })` + `channel.ack`/`channel.nack` are the direct analog.
 * - .NET copies the delivery's rented body buffer (`Body.ToArray()`) before handing it to a dispatcher
 *   lane because the buffer is only valid for the consumer callback. amqplib delivers a fresh `Buffer`
 *   per message that outlives the callback, so no copy is needed here.
 * - `CancellationToken` → optional `AbortSignal`. The logger is resolved lazily via `ILoggerFactory`
 *   through a scope (matching {@link BenzeneKafkaWorker}/{@link BenzeneServiceBusWorker}) rather than
 *   constructor-injected as in the C#.
 */
export class RabbitMqWorker implements IBenzeneWorker {
  private readonly config: RabbitMqConfig &
    Required<
      Pick<
        RabbitMqConfig,
        'topicHeaderKey' | 'prefetchCount' | 'concurrentRequests' | 'ackMode' | 'requeueOnFailure' | 'drainTimeoutMs'
      >
    >;
  private connection: ChannelModel | undefined;
  private channel: Channel | undefined;
  private dispatcher: BoundedConcurrentDispatcher<ConsumeMessage> | undefined;
  private consumerTag: string | undefined;

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly application: RabbitMqApplication,
    config: RabbitMqConfig,
    private readonly connectionFactory: IRabbitMqConnectionFactory,
  ) {
    this.config = withRabbitMqConfigDefaults(config);
  }

  /**
   * Opens the connection and channel, sets the prefetch QoS, and starts the consumer. Returns once
   * consuming has begun — it does not block until shutdown.
   */
  async startAsync(cancellationToken?: AbortSignal): Promise<void> {
    const autoAck = this.config.ackMode === RabbitMqAckMode.AutoAck;

    // The dispatcher starts its lane tasks as soon as it is constructed, before the (fallible) connection
    // is opened. If any step below throws, startAsync propagates but those lanes keep running — so tear
    // everything back down on failure (stopAsync is guarded on the channel/connection/tag it may not have
    // set yet) rather than leaking concurrentRequests idle lane tasks on a failed startup.
    this.dispatcher = new BoundedConcurrentDispatcher<ConsumeMessage>(
      this.config.concurrentRequests,
      (delivery) => this.handleDeliveryAsync(delivery, autoAck),
      this.resolveLogger(),
    );

    try {
      this.connection = await this.connectionFactory.createConnectionAsync(cancellationToken);
      this.channel = await this.connection.createChannel();

      await this.channel.prefetch(this.config.prefetchCount, false);

      const reply = await this.channel.consume(
        this.config.queueName,
        (msg) => {
          void this.onReceivedAsync(msg);
        },
        { noAck: autoAck },
      );
      this.consumerTag = reply.consumerTag;
    } catch (error) {
      await this.stopAsync();
      throw error;
    }
  }

  /**
   * Cancels the consumer, drains in-flight handlers (up to {@link RabbitMqConfig.drainTimeoutMs}), then
   * closes and disposes the channel and connection.
   */
  async stopAsync(_cancellationToken?: AbortSignal): Promise<void> {
    if (this.channel !== undefined && this.consumerTag !== undefined) {
      try {
        // Stop new deliveries first, so the drain below only has to wait for handlers already in flight
        // (and their acks) rather than a moving target.
        await this.channel.cancel(this.consumerTag);
      } catch (error) {
        this.resolveLogger().logError(
          error,
          `Cancelling RabbitMQ consumer ${this.consumerTag} failed during shutdown.`,
        );
      }
      this.consumerTag = undefined;
    }

    if (this.dispatcher !== undefined) {
      await this.dispatcher.drainAsync(this.config.drainTimeoutMs);
      this.dispatcher = undefined;
    }

    if (this.channel !== undefined) {
      await this.channel.close();
      this.channel = undefined;
    }

    if (this.connection !== undefined) {
      await this.connection.close();
      this.connection = undefined;
    }
  }

  private async onReceivedAsync(msg: ConsumeMessage | null): Promise<void> {
    // amqplib delivers `null` to the consume callback when the consumer is cancelled server-side; ignore
    // it (there is nothing to dispatch or settle).
    if (msg === null) {
      return;
    }

    const dispatcher = this.dispatcher;
    if (dispatcher !== undefined) {
      await dispatcher.enqueueAsync(msg);
    }
  }

  private async handleDeliveryAsync(delivery: ConsumeMessage, autoAck: boolean): Promise<void> {
    if (autoAck) {
      // The broker already acknowledged on dispatch; just run the handler (best effort).
      await this.application.handleAsync(delivery, this.serviceResolverFactory);
      return;
    }

    try {
      const messageResult = await this.application.handleAsync(delivery, this.serviceResolverFactory);

      if (messageResult?.isSuccessful === false) {
        this.nack(delivery);
      } else {
        this.ack(delivery);
      }
    } catch (error) {
      // A thrown handler exception settles exactly like a failure result — nack (requeue/DLX) — rather
      // than leaving the delivery unacknowledged until the channel closes.
      this.resolveLogger().logError(
        error,
        `Handling RabbitMQ delivery ${delivery.fields.deliveryTag} threw; nacking.`,
      );
      this.nack(delivery);
    }
  }

  private ack(delivery: ConsumeMessage): void {
    const channel = this.channel;
    if (channel === undefined) {
      return;
    }
    try {
      channel.ack(delivery);
    } catch (error) {
      this.resolveLogger().logError(
        error,
        `Acking RabbitMQ delivery ${delivery.fields.deliveryTag} failed.`,
      );
    }
  }

  private nack(delivery: ConsumeMessage): void {
    const channel = this.channel;
    if (channel === undefined) {
      return;
    }

    // Requeue is bounded to one retry: a first-attempt failure is requeued; an already-redelivered
    // failure is nacked without requeue (to the DLX / dropped) so a poison message can't hot-loop.
    const requeue = this.config.requeueOnFailure && !delivery.fields.redelivered;

    try {
      channel.nack(delivery, false, requeue);
    } catch (error) {
      this.resolveLogger().logError(
        error,
        `Nacking RabbitMQ delivery ${delivery.fields.deliveryTag} failed.`,
      );
    }
  }

  private resolveLogger(): ILogger {
    const scope = this.serviceResolverFactory.createScope();
    try {
      return scope.tryGetService(ILoggerFactory)?.createLogger('RabbitMqWorker') ?? NullLogger.instance;
    } finally {
      scope.dispose();
    }
  }
}
