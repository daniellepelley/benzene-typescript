import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
  IMessageHandlersList,
} from '@benzene/abstractions-message-handlers';

/**
 * A mutable, append-only finder; its `version` lets consumers (e.g.
 * MessageHandlerDefinitionIndex) detect additions and rebuild caches.
 * Port of Benzene.Core.MessageHandlers.MessageHandlersList.
 */
export class MessageHandlersList implements IMessageHandlersFinder, IMessageHandlersList {
  private readonly list: IMessageHandlerDefinition[] = [];

  private _version = 0;

  get version(): number {
    return this._version;
  }

  findDefinitions(): IMessageHandlerDefinition[] {
    return [...this.list];
  }

  add(messageHandlerDefinition: IMessageHandlerDefinition): void {
    this.list.push(messageHandlerDefinition);
    this._version += 1;
  }
}
