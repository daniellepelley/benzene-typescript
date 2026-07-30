import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { addBenzene } from '@benzene/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzene/self-host';
import { useBenzeneInvocation } from './Consumer/BenzeneInvocationExtensions';
import { ISqsClientFactory } from './Consumer/ISqsClientFactory';
import { SqsConsumer } from './Consumer/SqsConsumer';
import { SqsConsumerApplication } from './Consumer/SqsConsumerApplication';
import { SqsConsumerConfig } from './Consumer/SqsConsumerConfig';
import { SqsConsumerMessageContext } from './Consumer/SqsConsumerMessageContext';
import { SqsConsumerMessageTopicGetter } from './Consumer/SqsConsumerMessageTopicGetter';
import { SqsConsumerOptions } from './Consumer/SqsConsumerOptions';
import { addSqsConsumer } from './DependencyInjectionExtensions';

/**
 * Port of Benzene.Aws.Sqs.Extensions (C# fluent extension method -> free function taking the worker
 * startup as its first argument).
 *
 * Adds a standalone SQS polling consumer to a Benzene worker. Unlike `@benzene/aws-lambda-sqs`, which
 * processes SQS messages delivered via a Lambda event source mapping, this package polls SQS directly
 * using {@link SqsConsumer} — intended for long-running workers (e.g. `@benzene/self-host`) rather than
 * Lambda.
 *
 * Registers the benzene-message + SQS-consumer services, builds the inner per-message
 * `SqsConsumerMessageContext` pipeline (with `useBenzeneInvocation` auto-wired first) from `action`,
 * and adds a {@link SqsConsumer} worker over an {@link SqsConsumerApplication} wrapping that pipeline.
 * Optionally configure {@link SqsConsumerOptions} — e.g. set `ackMode` to
 * {@link SqsConsumerAckMode.WholeBatch} for all-or-nothing whole-batch deletion instead of the default
 * per-message deletion.
 *
 * @param app The worker startup to add the SQS consumer to.
 * @param sqsConsumerConfig The queue URL and batch size to poll with.
 * @param sqsClientFactory The factory used to create the underlying SQS client.
 * @param action Configures the inner SQS message pipeline.
 * @param configure Optionally configures {@link SqsConsumerOptions}.
 * @returns The worker startup, for chaining.
 */
export function useSqs(
  app: IBenzeneWorkerStartup,
  sqsConsumerConfig: SqsConsumerConfig,
  sqsClientFactory: ISqsClientFactory,
  action: PipelineBuilderAction<SqsConsumerMessageContext>,
  configure?: (options: SqsConsumerOptions) => void,
): IBenzeneWorkerStartup {
  const topicAttributeKey =
    sqsConsumerConfig.topicAttributeKey ?? SqsConsumerMessageTopicGetter.DefaultTopicAttribute;

  // PORT DIVERGENCE: C# calls `AddBenzeneMessage()` here; under the port's type erasure that would
  // register `BenzeneMessageGetter` under the single `IMessageGetter` / `IMessageBodyBytesGetter`
  // tokens and hijack routing/request-mapping over the SQS getters. So the port wires `addBenzene`
  // (base services, no message-envelope getters) + the consumer's own getters — as `useGrpc` does
  // (see the gRPC "wiring" divergence note in the README, which documents this same type-erasure fix).
  app.register((x) => {
    addBenzene(x);
    addSqsConsumer(x, topicAttributeKey);
  });

  const middlewarePipelineBuilder = app.create<SqsConsumerMessageContext>();
  useBenzeneInvocation(middlewarePipelineBuilder);
  action(middlewarePipelineBuilder);
  const pipeline = middlewarePipelineBuilder.build();

  const options: SqsConsumerOptions = {};
  configure?.(options);

  const sqsConsumerApplication = new SqsConsumerApplication(pipeline, options);
  app.add(
    (serviceResolverFactory) =>
      new SqsConsumer(
        serviceResolverFactory,
        sqsConsumerApplication,
        sqsConsumerConfig,
        sqsClientFactory,
        options,
      ),
  );
  return app;
}
