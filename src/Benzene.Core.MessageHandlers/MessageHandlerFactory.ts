import { ILoggerFactory, IServiceResolver, NullLoggerFactory } from '@benzenejs/abstractions';
import {
  IExecutableMessageHandler,
  IMessageHandler,
  IMessageHandlerDefinition,
  IMessageHandlerFactory,
  IMessageHandlerWrapper,
} from '@benzenejs/abstractions-message-handlers';
import { Topic } from '@benzenejs/core-messages';
import { MessageHandler } from './MessageHandler';
import { IDefaultStatuses } from './MessageResult';

/**
 * Resolves the handler class from the container, applies the handler wrapper and
 * binds it into an executable MessageHandler.
 * Port of Benzene.Core.MessageHandlers.MessageHandlerFactory.
 *
 * The C# expression-tree dispatcher exists only to close open generics at
 * runtime; JavaScript closures make it unnecessary. The C# runtime distinction
 * between `IMessageHandler<TRequest, TResponse>` and `IMessageHandler<TRequest>`
 * is likewise unnecessary: a no-response handler resolves `undefined`, which
 * MessageHandler already maps to Accepted.
 */
export class MessageHandlerFactory implements IMessageHandlerFactory {
  constructor(
    private readonly serviceResolver: IServiceResolver,
    private readonly messageHandlerWrapper: IMessageHandlerWrapper,
    private readonly loggerFactory: ILoggerFactory = NullLoggerFactory.instance,
    // Wire-contract status values (lowercase-kebab-case, per wire-contracts.md §3 / BenzeneResultStatus) -
    // kept as literals here to avoid a dependency on @benzenejs/results from this package.
    private readonly defaultStatuses: IDefaultStatuses = {
      validationError: 'validation-error',
      notFound: 'not-found',
      badRequest: 'bad-request',
    },
  ) {}

  create(messageHandlerDefinition: IMessageHandlerDefinition): IExecutableMessageHandler {
    const topic = new Topic(
      messageHandlerDefinition.topic.id,
      messageHandlerDefinition.topic.version,
    );

    const messageHandler = this.serviceResolver.getService(
      messageHandlerDefinition.handlerType,
    ) as IMessageHandler<unknown, unknown>;

    const logger = this.loggerFactory.createLogger(messageHandlerDefinition.handlerType.name);
    const wrapped = this.messageHandlerWrapper.wrap(topic, messageHandler);

    return new MessageHandler(wrapped, logger, this.defaultStatuses);
  }
}
