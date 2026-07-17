import { ITopic } from '@benzene/abstractions-messages';
import {
  IMessageHandlerDefinition,
  IMessageHandlerDefinitionLookUp,
  IVersionSelector,
} from '@benzene/abstractions-message-handlers';
import { MessageHandlerDefinitionIndex } from './MessageHandlerDefinitionIndex';

/**
 * Port of Benzene.Core.MessageHandlers.MessageHandlerDefinitionLookUp.
 */
export class MessageHandlerDefinitionLookUp implements IMessageHandlerDefinitionLookUp {
  constructor(
    private readonly index: MessageHandlerDefinitionIndex,
    private readonly versionSelector: IVersionSelector,
  ) {}

  findHandler(topic: ITopic): IMessageHandlerDefinition | undefined {
    const handlers = this.index.getByTopicId(topic.id);
    if (handlers.length === 0) {
      return undefined;
    }

    const selectedVersion = this.versionSelector.select(
      topic.version,
      handlers.map((handler) => handler.topic.version),
    );

    return handlers.find((handler) => handler.topic.version === selectedVersion);
  }

  getAllHandlers(): IMessageHandlerDefinition[] {
    return this.index.getAll();
  }
}
