/** Port of Benzene.Kafka.Core.KafkaMessage.BenzeneInvocationExtensions. */
import { ServiceIdentifier } from '@benzenejs/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { BenzeneInvocation, useBenzeneInvocation as coreUseBenzeneInvocation } from '@benzenejs/core-middleware';
import { WorkerApplicationBuilder } from '@benzenejs/self-host';
import { KafkaRecordContext } from './KafkaRecordContext';

/**
 * Adds middleware that exposes an `IBenzeneInvocation` for the duration of each consumed record's
 * dispatch, with `invocationId` set to `"{topic}-{partition}-{offset}"` — Kafka records have no single
 * message-id field, but this triple uniquely identifies a record (matching the C#). Auto-wired by
 * `useKafka(...)` as the first middleware in the Kafka pipeline — a long-running worker has no
 * Lambda/Functions-style outer "invocation" boundary, so this is the only invocation identity available
 * here.
 */
export function useBenzeneInvocation(
  app: IMiddlewarePipelineBuilder<KafkaRecordContext>,
): IMiddlewarePipelineBuilder<KafkaRecordContext> {
  return coreUseBenzeneInvocation(
    app,
    (_serviceResolver, context) =>
      new BenzeneInvocation(
        `${context.record.topic}-${context.record.partition}-${context.record.message.offset}`,
        WorkerApplicationBuilder.platformName,
        new Map<ServiceIdentifier<unknown>, unknown>(),
      ),
  );
}
