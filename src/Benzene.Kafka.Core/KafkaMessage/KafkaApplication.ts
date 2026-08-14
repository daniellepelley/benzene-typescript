/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaApplication. */
import { EachMessagePayload } from 'kafkajs';
import { IMessageResult, TransportNames } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline } from '@benzenejs/core-message-handlers';
import { MiddlewareApplicationWithResult } from '@benzenejs/core-middleware';
import { KafkaRecordContext } from './KafkaRecordContext';

/**
 * Processes a single consumed record by mapping it to a {@link KafkaRecordContext} and running it
 * through the middleware pipeline in its own service scope, tagging the transport as `"kafka"` for the
 * duration. Returns the handler's recorded result (or `undefined` if nothing set one), which the worker
 * reads for the `commitOnlyOnSuccess` gating.
 *
 * PORTING NOTE: the C# `KafkaApplication` extends the plain `MiddlewareApplication<TEvent, TContext>`
 * (no result — the C# worker gates commits on whether `HandleAsync` threw). To make the record's
 * outcome available to the worker (and to mirror `EventHubConsumerApplication`), this port extends
 * `MiddlewareApplicationWithResult` and surfaces `context.messageResult`.
 */
export class KafkaApplication extends MiddlewareApplicationWithResult<
  EachMessagePayload,
  KafkaRecordContext,
  IMessageResult | undefined
> {
  constructor(pipeline: IMiddlewarePipeline<KafkaRecordContext>) {
    super(
      new TransportMiddlewarePipeline<KafkaRecordContext>(TransportNames.Kafka, pipeline),
      KafkaRecordContext.createInstance,
      (context) => context.messageResult,
    );
  }
}
