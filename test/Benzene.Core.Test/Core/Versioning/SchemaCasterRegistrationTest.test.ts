import { describe, expect, it } from 'vitest';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  ISchemaCasterOf,
  ISchemaCasters,
  registerPayloadSchemaVersions,
  registerSchemaCastDefinitions,
} from '@benzene/core-versioning';
import { V1OrderPayload, V2OrderPayload, V3OrderPayload } from './exampleSchemas';

/**
 * Port of test/Benzene.Core.Test/Core/Versioning/SchemaCasterRegistrationTest.cs. Individually registered
 * casters are collected via `getServices(ISchemaCaster)` and expanded into an `ISchemaCasters` singleton,
 * composing the V1 -> V2 -> V3 chain. Uses `DefaultBenzeneServiceContainer` in place of the Microsoft DI.
 */

describe('SchemaCasterRegistration', () => {
  it('RegisterPayloadSchemaVersions_ResolvesExpandedSchemaCasters', () => {
    const container = new DefaultBenzeneServiceContainer();

    registerSchemaCastDefinitions(container, (builder) =>
      builder
        .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'orderCreated', 'V1', 'V2', (f) => {
          const t = new V2OrderPayload();
          t.id = f.id;
          t.quantity = f.quantity;
          return t;
        })
        .add<V2OrderPayload, V3OrderPayload>(V2OrderPayload, V3OrderPayload, 'orderCreated', 'V2', 'V3', (f) => {
          const t = new V3OrderPayload();
          t.id = f.id;
          t.quantity = f.quantity;
          return t;
        }),
    );
    registerPayloadSchemaVersions(container, [
      { topic: 'orderCreated', fromSchemas: ['V1', 'V2', 'V3'], toSchemas: ['V3'] },
    ]);

    const scope = container.createServiceResolverFactory().createScope();
    const schemaCasters = scope.getService(ISchemaCasters);

    const composite = schemaCasters.getSchemaCaster('V1', 'V3', 'orderCreated') as ISchemaCasterOf<
      V1OrderPayload,
      V3OrderPayload
    >;

    const v1 = new V1OrderPayload();
    v1.id = 'order-1';
    v1.quantity = 5;
    const result = composite.caster.cast(v1);
    scope.dispose();

    expect(result.id).toBe('order-1');
    expect(result.quantity).toBe(5);
  });
});
