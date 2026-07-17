import { IMessageDefinition } from './IMessageDefinition';

/**
 * Discovers message definitions of a given kind.
 * Port of Benzene.Abstractions.Messages.IMessageDefinitionFinder&lt;TMessageDefinition&gt;.
 */
export interface IMessageDefinitionFinder<TMessageDefinition extends IMessageDefinition> {
  findDefinitions(): TMessageDefinition[];
}
