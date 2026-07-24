import { ILoggerFactory, IServiceResolver } from '@benzene/abstractions';
import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import { IResponseEventPublisher } from './IResponseEventPublisher';
import { PublishFailureMode } from './PublishFailureMode';
import { ResponseEventMappings } from './ResponseEventMappings';

const loggerCategory = 'Benzene.ResponseEvents';

/**
 * Handler middleware that republishes a handler's response as follow-up events, per the pipeline's
 * {@link ResponseEventMappings}: after the handler runs, every mapping that matches the (topic, result)
 * pair publishes through the registered {@link IResponseEventPublisher}. Added per pipeline via
 * {@link useResponseEvents}.
 * Port of Benzene.ResponseEvents.ResponseEventsMiddleware&lt;TRequest, TResponse&gt;.
 *
 * The publisher is resolved lazily - only when a mapping actually matched. Publish failures follow the
 * pipeline's {@link PublishFailureMode}: `FailMessage` replaces the response with an `UnexpectedError`
 * (and stops publishing further matches) so the transport nacks/redelivers; `LogAndContinue` logs and
 * keeps going.
 */
export class ResponseEventsMiddleware<TRequest, TResponse>
  implements IMiddleware<IMessageHandlerContext<TRequest, TResponse>>
{
  readonly name = 'ResponseEvents';

  constructor(
    private readonly mappings: ResponseEventMappings,
    private readonly serviceResolver: IServiceResolver,
  ) {}

  async handleAsync(
    context: IMessageHandlerContext<TRequest, TResponse>,
    next: NextFunc,
  ): Promise<void> {
    await next();

    const response = context.response;
    if (response == null) {
      return;
    }

    const publications = this.mappings.resolve(context.topic, response);
    if (publications.length === 0) {
      return;
    }

    const publisher = this.serviceResolver.getService(IResponseEventPublisher);
    for (const publication of publications) {
      let failureReason: string;
      let exception: unknown;
      try {
        const publishResult = await publisher.publishAsync(publication.eventTopic, publication.payload);
        if (publishResult.isSuccessful) {
          continue;
        }

        failureReason = `publish returned status '${publishResult.status}'`;
      } catch (error) {
        exception = error;
        failureReason = error instanceof Error ? error.message : String(error);
      }

      const logger = this.serviceResolver.tryGetService(ILoggerFactory)?.createLogger(loggerCategory);
      const message = `Failed to publish response event ${publication.eventTopic} for ${context.topic.id}: ${failureReason}`;

      if (this.mappings.publishFailureMode === PublishFailureMode.FailMessage) {
        logger?.logError(exception, message);
        context.response = BenzeneResult.unexpectedError<TResponse>(
          `Failed to publish response event '${publication.eventTopic}': ${failureReason}`,
        );
        return;
      }

      logger?.logWarning(message);
    }
  }
}
