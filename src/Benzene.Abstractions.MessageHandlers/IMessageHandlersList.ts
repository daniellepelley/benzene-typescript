import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageHandlerDefinition } from './IMessageHandlerDefinition';

/**
 * A mutable list of handler definitions that can be appended to at runtime.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlersList.
 */
export interface IMessageHandlersList {
  add(messageHandlerDefinition: IMessageHandlerDefinition): void;
}

export const IMessageHandlersList: ServiceToken<IMessageHandlersList> =
  serviceToken<IMessageHandlersList>('IMessageHandlersList');
