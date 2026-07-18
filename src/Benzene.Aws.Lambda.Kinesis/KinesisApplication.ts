/** Port of Benzene.Aws.Lambda.Kinesis.KinesisStreamApplication (adapted — see the ADAPTATION note). */
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { KinesisStreamEvent } from 'aws-lambda';
import { KinesisMessageContext } from './KinesisMessageContext';

/**
 * Processes a Kinesis batch by mapping each record to a `KinesisMessageContext` and running them all
 * through the middleware pipeline concurrently, tagging the transport as `"kinesis"` for the duration.
 *
 * STREAMING -> PER-RECORD FAN-OUT ADAPTATION: the C# `KinesisStreamApplication` runs the whole batch as
 * ONE `StreamContext<KinesisEventRecord>` through the (unported) streaming engine — a fan-IN that
 * preserves shard ordering. That engine is not yet available in this repo, so this port instead fans the
 * batch OUT per record (the SQS/SNS shape already established here), routing each record to a `@message`
 * handler. See `KinesisMessageContext` for the full rationale. Like the C# original, this is
 * fire-and-forget (`IMiddlewareApplication<KinesisStreamEvent>`, no response). The transport is tagged via
 * the already-ported `TransportMiddlewarePipeline("kinesis", pipeline)`, exactly as the C# constructor
 * wraps its pipeline. Each record runs in ITS OWN scope (`createScope()` / try-finally `dispose()`),
 * concurrently via `Promise.all` (the port of `Task.WhenAll`).
 */
export class KinesisApplication implements IMiddlewareApplication<KinesisStreamEvent> {
  private readonly pipeline: IMiddlewarePipeline<KinesisMessageContext>;

  constructor(pipeline: IMiddlewarePipeline<KinesisMessageContext>) {
    this.pipeline = new TransportMiddlewarePipeline<KinesisMessageContext>('kinesis', pipeline);
  }

  async handleAsync(
    event: KinesisStreamEvent,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const records = event.Records ?? [];
    const tasks = records
      .map((record) => KinesisMessageContext.createInstance(event, record))
      .map(async (context) => {
        const scope = serviceResolverFactory.createScope();
        try {
          await this.pipeline.handleAsync(context, scope);
        } finally {
          scope.dispose();
        }
      });

    await Promise.all(tasks);
  }
}
