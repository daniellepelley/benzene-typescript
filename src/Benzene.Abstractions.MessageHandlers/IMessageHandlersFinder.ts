import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageDefinitionFinder } from '@benzene/abstractions-messages';
import { IMessageHandlerDefinition } from './IMessageHandlerDefinition';

/**
 * Discovers message handler definitions. This is the extension point for handler
 * discovery: the default implementation finds decorator-registered handlers, and
 * alternatives (explicit lists, DI-registered definitions, composites) can be
 * swapped in.
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlersFinder.
 */
export interface IMessageHandlersFinder
  extends IMessageDefinitionFinder<IMessageHandlerDefinition> {}

export const IMessageHandlersFinder: ServiceToken<IMessageHandlersFinder> =
  serviceToken<IMessageHandlersFinder>('IMessageHandlersFinder');
