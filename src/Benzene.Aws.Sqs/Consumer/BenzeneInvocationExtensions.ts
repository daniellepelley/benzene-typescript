import { ServiceIdentifier } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { BenzeneInvocation, useBenzeneInvocation as coreUseBenzeneInvocation } from '@benzene/core-middleware';
import { WorkerApplicationBuilder } from '@benzene/self-host';
import { SqsConsumerMessageContext } from './SqsConsumerMessageContext';

/**
 * Port of Benzene.Aws.Sqs.Consumer.BenzeneInvocationExtensions (C# extension method -> free function
 * taking the builder first).
 *
 * Adds middleware that exposes an `IBenzeneInvocation` for the duration of each polled message's
 * dispatch, with `invocationId` set to the message's SQS `MessageId`.
 *
 * Each polled message is dispatched through its own DI scope (`SqsConsumerApplication`'s per-message
 * scope), which has no ambient `IBenzeneInvocation` of its own — a long-running worker has no
 * Lambda-style outer "invocation" boundary at all, so this is the only invocation identity available
 * here. Auto-wired by `useSqs(...)` as the first middleware in the SQS consumer pipeline, so no
 * application code changes are required.
 *
 * DIVERGENCE from C#: C# passes the message's `MessageId` directly (nullable). aws-sdk v3's `Message.
 * MessageId` is `string | undefined`, so it falls back to an empty string, matching the port's other
 * invocation-id handling.
 */
export function useBenzeneInvocation(
  app: IMiddlewarePipelineBuilder<SqsConsumerMessageContext>,
): IMiddlewarePipelineBuilder<SqsConsumerMessageContext> {
  return coreUseBenzeneInvocation(
    app,
    (_serviceResolver, context) =>
      new BenzeneInvocation(
        context.message.MessageId ?? '',
        WorkerApplicationBuilder.platformName,
        new Map<ServiceIdentifier<unknown>, unknown>(),
      ),
  );
}
