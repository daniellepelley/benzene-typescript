import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageDefinition } from './IMessageDefinition';

/**
 * Discovers message definitions of a given kind.
 * Port of Benzene.Abstractions.Messages.IMessageDefinitionFinder&lt;TMessageDefinition&gt;.
 */
export interface IMessageDefinitionFinder<TMessageDefinition extends IMessageDefinition> {
  findDefinitions(): TMessageDefinition[];
}

/**
 * Token for the closed `IMessageDefinitionFinder<IMessageDefinition>` registration — the only closed
 * form .NET registers against (a generic interface cannot carry a single token in TypeScript, so this
 * names the base-`IMessageDefinition` finder specifically). Sub-finders such as `IBroadcastEventChecker`
 * register under both their own token and this one, so a generic consumer (e.g. the schema/mesh tooling)
 * can collect every message-definition finder.
 */
export const IMessageDefinitionFinder: ServiceToken<IMessageDefinitionFinder<IMessageDefinition>> =
  serviceToken<IMessageDefinitionFinder<IMessageDefinition>>('IMessageDefinitionFinder');
