import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageDefinitionFinder } from './IMessageDefinitionFinder';
import { IMessageSenderDefinition } from './IMessageSenderDefinition';

/**
 * Discovers outbound sender definitions — the sender-side counterpart of `IMessageHandlersFinder`.
 * Port of Benzene.Abstractions.Messages.IMessageSendersFinder.
 */
export interface IMessageSendersFinder extends IMessageDefinitionFinder<IMessageSenderDefinition> {}

export const IMessageSendersFinder: ServiceToken<IMessageSendersFinder> =
  serviceToken<IMessageSendersFinder>('IMessageSendersFinder');
