/** Port of Benzene.Kafka.Core.Kafka.KafkaBenzeneMessageClient. */
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
import { Producer } from 'kafkajs';
import { KafkaContextConverter } from './KafkaContextConverter';
import { isKafkaMessagePersisted, KafkaSendMessageContext } from './KafkaSendMessageContext';
import { useKafkaClient } from './Extensions';

/**
 * An {@link IBenzeneMessageClient} that produces outbound messages to Kafka, so business logic depends
 * only on the transport-agnostic client surface. A message is converted to a
 * {@link KafkaSendMessageContext} and run through a one-middleware produce pipeline.
 *
 * The two C# constructors (producer / prebuilt pipeline) collapse into one that accepts either a kafkajs
 * `Producer` (builds the default single-middleware pipeline) or an already-built
 * `IMiddlewarePipeline<KafkaSendMessageContext>` (for testing).
 */
export class KafkaBenzeneMessageClient implements IBenzeneMessageClient {
  // Shared across every send rather than constructed per call: a `JsonSerializer` caches resolved
  // metadata per instance, so a fresh one per send would defeat that cache.
  private static readonly SharedSerializer: ISerializer = new JsonSerializer();

  private readonly middlewarePipeline: IMiddlewarePipeline<KafkaSendMessageContext>;

  constructor(
    producerOrPipeline: Producer | IMiddlewarePipeline<KafkaSendMessageContext>,
    private readonly logger: ILogger = NullLogger.instance,
    private readonly serviceResolver: IServiceResolver = new NullServiceResolver(),
  ) {
    if (isMiddlewarePipeline(producerOrPipeline)) {
      this.middlewarePipeline = producerOrPipeline;
    } else {
      this.middlewarePipeline = useKafkaClient(
        new MiddlewarePipelineBuilder<KafkaSendMessageContext>(new NullBenzeneServiceContainer()),
        producerOrPipeline,
      ).build();
    }
  }

  async sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    try {
      const converter = new KafkaContextConverter<TRequest>(KafkaBenzeneMessageClient.SharedSerializer);
      const context = await converter.createRequestAsync(
        new BenzeneClientContext<TRequest, VoidResult>(request),
      );

      await this.middlewarePipeline.handleAsync(context, this.serviceResolver);

      return isKafkaMessagePersisted(context.response)
        ? BenzeneResult.accepted<TResponse>()
        : BenzeneResult.unexpectedError<TResponse>();
    } catch (ex) {
      this.logger.logError(ex, `Sending message ${request.topic} failed`);
      return BenzeneResult.serviceUnavailable<TResponse>(ex instanceof Error ? ex.message : String(ex));
    }
  }

  dispose(): void {
    // Intentionally empty — the producer's lifetime is owned by the caller.
  }
}

function isMiddlewarePipeline(
  value: Producer | IMiddlewarePipeline<KafkaSendMessageContext>,
): value is IMiddlewarePipeline<KafkaSendMessageContext> {
  return typeof (value as IMiddlewarePipeline<KafkaSendMessageContext>).handleAsync === 'function';
}
