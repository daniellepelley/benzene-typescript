/** Port of Benzene.Aws.Lambda.Kafka.KafkaApplication. */
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewareMultiApplication } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { MSKEvent } from 'aws-lambda';
import { KafkaContext } from './KafkaContext';

/**
 * Processes a Kafka event by FLATTENING its per-topic-partition records into a single list of
 * `KafkaContext` instances and running them all through the middleware pipeline concurrently (each in its
 * own DI scope), tagging the transport as `"kafka"` for the duration.
 *
 * Faithful to .NET: C# `KafkaApplication : MiddlewareMultiApplication<KafkaEvent, KafkaContext>` maps to the
 * ported `MiddlewareMultiApplication<MSKEvent, KafkaContext>` (fire-and-forget, no response). STRUCTURAL
 * note: the event's `records` is an OBJECT keyed by `"topic-partition"`, so the C# `@event.Records.Values
 * .SelectMany(...)` becomes `Object.values(event.records).flatMap(...)` — one context per record across all
 * partitions.
 */
export class KafkaApplication extends MiddlewareMultiApplication<MSKEvent, KafkaContext> {
  constructor(pipeline: IMiddlewarePipeline<KafkaContext>) {
    super(
      new TransportMiddlewarePipeline<KafkaContext>('kafka', pipeline),
      (event) =>
        Object.values(event.records).flatMap((records) =>
          records.map((record) => new KafkaContext(event, record)),
        ),
    );
  }
}
