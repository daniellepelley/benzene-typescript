import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageHandlerDefinition } from './IMessageHandlerDefinition';
import { IExecutableMessageHandler } from './IMessageHandler';

/**
 * Creates an executable handler for a definition, resolving the handler class
 * from the container.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerFactory.
 */
export interface IMessageHandlerFactory {
  create(messageHandlerDefinition: IMessageHandlerDefinition): IExecutableMessageHandler;
}

export const IMessageHandlerFactory: ServiceToken<IMessageHandlerFactory> =
  serviceToken<IMessageHandlerFactory>('IMessageHandlerFactory');
