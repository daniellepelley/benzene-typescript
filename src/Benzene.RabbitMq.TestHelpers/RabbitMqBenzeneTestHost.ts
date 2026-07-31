/** Port of Benzene.RabbitMq.TestHelpers.RabbitMqBenzeneTestHost. */
import type { ConsumeMessage } from 'amqplib';
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMessageResult } from '@benzene/abstractions-message-handlers';
import { RabbitMqApplication } from '@benzene/rabbitmq';

/**
 * A test host that drives the RabbitMQ message pipeline a `StartUp` configured, without a running
 * broker. Built by {@link buildRabbitMqWorkerHost}; push a delivery through it with
 * {@link RabbitMqBenzeneTestHost.handleAsync} (build one from a `messageBuilder(...)` via
 * `asRabbitMqBenzeneMessage(...)`).
 *
 * IDIOM MAP: C# `IDisposable.Dispose` → `dispose()` (the port's disposal convention); the underlying
 * `handleAsync` keeps the documented `Async` suffix camelCased, and C#'s `Task<IBenzeneResult?>` return
 * maps to `Promise<IMessageResult | undefined>` (the port's message-result type). Front door in
 * (`ConsumeMessage`, the amqplib delivery the getters read — see the `AsRabbitMqBenzeneMessage`
 * message-type adaptation), the handler's recorded result out — assert on the result and on what a faked
 * outbound client captured.
 */
export class RabbitMqBenzeneTestHost {
  constructor(
    private readonly application: RabbitMqApplication,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  /**
   * Runs a delivery through the pipeline exactly as `RabbitMqWorker` would, returning the handler's
   * recorded result (the worker reads it to decide ack/nack), or `undefined` if nothing set one.
   * @param delivery The delivery to handle (typically built by `asRabbitMqBenzeneMessage(...)`).
   * @returns The handler's result, or `undefined`.
   */
  handleAsync(delivery: ConsumeMessage): Promise<IMessageResult | undefined> {
    return this.application.handleAsync(delivery, this.serviceResolverFactory);
  }

  /** Disposes the resolver factory (and the service provider it owns). Port of C# `Dispose`. */
  dispose(): void {
    this.serviceResolverFactory.dispose();
  }
}
