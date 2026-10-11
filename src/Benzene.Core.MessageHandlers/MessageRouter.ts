import { BenzeneTopic, IBenzeneResult, ILogger, NullLogger } from '@benzenejs/abstractions';
import {
  IMessageGetter,
  IMessageHandlerDefinitionLookUp,
  IMessageHandlerFactory,
  IMessageHandlerResultSetter,
  IRequestMapper,
} from '@benzenejs/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { IDefaultStatuses } from './MessageResult';
import { MessageHandlerDefinition } from './MessageHandlerDefinition';
import { MessageHandlerResult } from './MessageHandlerResult';
import { RequestMapperThunk } from './RequestMapperThunk';

/**
 * The pipeline entry point for message-handler dispatch: extracts the topic from the incoming
 * context, looks up and creates the matching handler, invokes it, and hands the resulting
 * `IMessageHandlerResult` to the registered `IMessageHandlerResultSetter<TContext>`.
 * Port of Benzene.Core.MessageHandlers.MessageRouter&lt;TContext&gt;.
 *
 * If the topic is missing, no matching handler definition is found, or the factory can't create a
 * handler, the router short-circuits with an error result instead of calling `next` — so this
 * middleware is always the terminal step for message-handler dispatch.
 *
 * C# injects `ILogger<MessageRouter<TContext>>`; the port takes a plain `ILogger` (defaulting to
 * `NullLogger`), matching how the ported `MessageHandler` handles its logger.
 */
export class MessageRouter<TContext> implements IMiddleware<TContext> {
  constructor(
    private readonly messageHandlerFactory: IMessageHandlerFactory,
    private readonly messageGetter: IMessageGetter<TContext>,
    private readonly messageHandlerDefinitionLookUp: IMessageHandlerDefinitionLookUp,
    private readonly requestMapper: IRequestMapper<TContext>,
    private readonly messageHandlerResultSetter: IMessageHandlerResultSetter<TContext>,
    private readonly defaultStatuses: IDefaultStatuses,
    private readonly logger: ILogger = NullLogger.instance,
  ) {}

  readonly name = 'MessageRouter';

  async handleAsync(context: TContext, _next: NextFunc): Promise<void> {
    const topic = this.messageGetter.getTopic(context);
    if (topic === undefined || topic.id === undefined || topic.id === '') {
      this.logger.logWarning('Topic is missing');
      await this.messageHandlerResultSetter.setResultAsync(
        context,
        new MessageHandlerResult(
          topic,
          MessageHandlerDefinition.empty(),
          BenzeneResult.setErrors(this.defaultStatuses.validationError, 'Topic is missing'),
        ),
      );
      return;
    }

    this.logger.logDebug(`Finding message handler for ${topic.id}`);
    const messageHandlerDefinition = this.messageHandlerDefinitionLookUp.findHandler(topic);
    if (messageHandlerDefinition === undefined && topic.id.toLowerCase() === BenzeneTopic.ping) {
      // benzene:ping (wire-contracts §7): a reachability probe, answered `ok` with no payload, by topic id
      // alone. Served by default so a probe sent into a one-way transport is acknowledged instead of being
      // a not-found failure the transport redelivers until it dead-letters it. A handler the application
      // registers for the topic takes precedence.
      await this.messageHandlerResultSetter.setResultAsync(
        context,
        new MessageHandlerResult(topic, MessageHandlerDefinition.empty(), BenzeneResult.ok()),
      );
      return;
    }

    if (messageHandlerDefinition === undefined) {
      // Names the topic and, when the message carried one, the version (core-concepts §2): a version no
      // handler serves is not-found, never silently another version's handler.
      const notFound = describeUnmatched(topic);
      this.logger.logWarning(notFound);
      await this.messageHandlerResultSetter.setResultAsync(
        context,
        new MessageHandlerResult(
          topic,
          MessageHandlerDefinition.empty(),
          BenzeneResult.setErrors(this.defaultStatuses.notFound, notFound),
        ),
      );
      return;
    }

    const handler = this.messageHandlerFactory.create(messageHandlerDefinition);
    if (handler === undefined || handler === null) {
      this.logger.logWarning(`No handler found for topic ${topic.id}`);
      await this.messageHandlerResultSetter.setResultAsync(
        context,
        new MessageHandlerResult(
          topic,
          messageHandlerDefinition,
          BenzeneResult.setErrors(
            this.defaultStatuses.notFound,
            `No handler found for topic ${topic.id}`,
          ),
        ),
      );
      return;
    }

    this.logger.logDebug('Handler mapped to topic');

    const result: IBenzeneResult = await handler.handleAsync(
      new RequestMapperThunk<TContext>(this.requestMapper, context, messageHandlerDefinition.requestType),
    );
    await this.messageHandlerResultSetter.setResultAsync(
      context,
      new MessageHandlerResult(topic, messageHandlerDefinition, result),
    );
  }
}

function describeUnmatched(topic: { id: string; version: string }): string {
  return topic.version === undefined || topic.version === ''
    ? `No handler found for topic ${topic.id}`
    : `No handler found for topic ${topic.id} version ${topic.version}`;
}
