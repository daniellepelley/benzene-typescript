import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IMessageHandlerDefinition } from './IMessageHandlerDefinition';

/**
 * Looks up the handler definition for a topic, applying version selection.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerDefinitionLookUp.
 */
export interface IMessageHandlerDefinitionLookUp {
  /** Port of C# `FindHandler(ITopic)`; C# `null` maps to `undefined`. */
  findHandler(topic: ITopic): IMessageHandlerDefinition | undefined;

  getAllHandlers(): IMessageHandlerDefinition[];
}

export const IMessageHandlerDefinitionLookUp: ServiceToken<IMessageHandlerDefinitionLookUp> =
  serviceToken<IMessageHandlerDefinitionLookUp>('IMessageHandlerDefinitionLookUp');
