/** Port of Benzene.Core.Versioning.Schemas.SchemaCasterExtensions. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { ISchemaCaster } from './ISchemaCaster';
import { ISchemaCasters } from './ISchemaCasters';
import { PayloadSchemaVersions } from './PayloadSchemaVersions';
import { SchemaCastDefinitionsExpander } from './SchemaCastDefinitionsExpander';
import { SchemaCasters } from './SchemaCasters';
import { SchemaCastersBuilder } from './SchemaCastersBuilder';

/** DI registration helpers for schema casters. C# extension methods -> free functions. */

/**
 * Registers an {@link ISchemaCasters} singleton that expands the individually registered
 * {@link ISchemaCaster} instances into the full set required by `payloadSchemaVersions`, composing
 * multi-step chains where no direct caster exists.
 */
export function registerPayloadSchemaVersions(
  services: IBenzeneServiceContainer,
  payloadSchemaVersions: Iterable<PayloadSchemaVersions>,
): IBenzeneServiceContainer {
  const versions = [...payloadSchemaVersions];
  services.addSingletonFactory(
    ISchemaCasters,
    (resolver) =>
      new SchemaCasters(
        new SchemaCastDefinitionsExpander().expand(resolver.getServices(ISchemaCaster), versions),
      ),
  );
  return services;
}

/** Registers each schema caster built by `action` as an {@link ISchemaCaster} singleton. */
export function registerSchemaCastDefinitions(
  services: IBenzeneServiceContainer,
  action: (builder: SchemaCastersBuilder) => void,
): IBenzeneServiceContainer {
  const builder = new SchemaCastersBuilder();
  action(builder);

  for (const schemaCastDefinition of builder.build()) {
    services.addSingletonInstance(ISchemaCaster, schemaCastDefinition);
  }

  return services;
}
