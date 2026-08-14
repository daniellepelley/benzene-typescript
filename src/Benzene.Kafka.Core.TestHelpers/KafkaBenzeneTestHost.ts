/** Port of Benzene.Kafka.Core.TestHelpers.KafkaBenzeneTestHost. */
import type { EachMessagePayload } from 'kafkajs';
import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { KafkaApplication } from '@benzenejs/kafka-core';

/**
 * A test host that drives the Kafka message pipeline a `StartUp` configured, without a running broker.
 * Built by {@link buildKafkaWorkerHost}; push a record through it with
 * {@link KafkaBenzeneTestHost.handleAsync} (build one from a `messageBuilder(...)` via
 * `asKafkaBenzeneMessage(...)`).
 *
 * PORT DIVERGENCE: the C# `KafkaBenzeneTestHost<TKey, TValue>` is generic over the record key/value
 * types; the port's `KafkaApplication` erases those generics (kafkajs delivers a raw
 * `EachMessagePayload` with `Buffer` key/value), so this host is non-generic — matching the erasure
 * documented on `useKafka` / `KafkaApplication`.
 *
 * IDIOM MAP: C# `IDisposable.Dispose` → `dispose()` (the port's disposal convention); the underlying
 * `handleAsync` keeps the documented `Async` suffix camelCased. C# `HandleAsync` returns bare `Task`
 * (void); the port returns the record's recorded `IMessageResult | undefined`, matching the
 * `KafkaApplication` result-surfacing divergence (the port's `KafkaApplication` extends
 * `MiddlewareApplicationWithResult` so the worker can gate `commitOnlyOnSuccess`).
 */
export class KafkaBenzeneTestHost {
  constructor(
    private readonly application: KafkaApplication,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  /**
   * Runs a record through the pipeline exactly as `BenzeneKafkaWorker` would, returning the handler's
   * recorded result (the worker reads it for `commitOnlyOnSuccess` gating), or `undefined` if nothing
   * set one.
   * @param record The record to handle (typically built by `asKafkaBenzeneMessage(...)`).
   * @returns The handler's result, or `undefined`.
   */
  handleAsync(record: EachMessagePayload): Promise<IMessageResult | undefined> {
    return this.application.handleAsync(record, this.serviceResolverFactory);
  }

  /** Disposes the resolver factory (and the service provider it owns). Port of C# `Dispose`. */
  dispose(): void {
    this.serviceResolverFactory.dispose();
  }
}
