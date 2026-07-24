/** Port of Benzene.SchemaRegistry.Core.Extensions. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { ISchemaRegistryClient } from './ISchemaRegistryClient';

/**
 * DI registration for a schema registry client. C# extension method -> a free function taking the
 * container first. Registers `client` as the {@link ISchemaRegistryClient} singleton.
 */
export function addSchemaRegistry(
  services: IBenzeneServiceContainer,
  client: ISchemaRegistryClient,
): IBenzeneServiceContainer {
  services.addSingletonInstance(ISchemaRegistryClient, client);
  return services;
}
