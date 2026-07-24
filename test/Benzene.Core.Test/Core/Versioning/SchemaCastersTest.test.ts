import { describe, expect, it } from 'vitest';
import {
  ISchemaCaster,
  ISchemaCasterOf,
  SchemaCasters,
  SchemaCastersBuilder,
} from '@benzene/core-versioning';
import { V1OrderPayload, V2OrderPayload } from './exampleSchemas';

/**
 * Port of test/Benzene.Core.Test/Core/Versioning/SchemaCastersTest.cs. The auto-mapper isn't ported, so
 * the casters are explicit `(from) => to` functions (preserving id + quantity) rather than the C#
 * property auto-mapping.
 */

const v1ToV2 = (f: V1OrderPayload): V2OrderPayload => {
  const t = new V2OrderPayload();
  t.id = f.id;
  t.quantity = f.quantity;
  return t;
};

const v2ToV1 = (f: V2OrderPayload): V1OrderPayload => {
  const t = new V1OrderPayload();
  t.id = f.id;
  t.quantity = f.quantity;
  return t;
};

function buildCasters(): ISchemaCaster[] {
  return new SchemaCastersBuilder()
    .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'orderCreated', 'V1', 'V2', v1ToV2)
    .add<V2OrderPayload, V1OrderPayload>(V2OrderPayload, V1OrderPayload, 'orderCreated', 'V2', 'V1', v2ToV1)
    .build();
}

describe('SchemaCasters', () => {
  it('GetSchemaCaster_FindsMatchingDefinition', () => {
    const casters = new SchemaCasters(buildCasters());

    const caster = casters.getSchemaCaster('V1', 'V2', 'orderCreated');

    expect(caster.definition.fromSchema).toBe('V1');
    expect(caster.definition.toSchema).toBe('V2');
    expect(caster.definition.topic).toBe('orderCreated');
    expect(caster.fromType).toBe(V1OrderPayload);
    expect(caster.toType).toBe(V2OrderPayload);
  });

  it('GetSchemaCaster_ThrowsWhenNoDefinitionMatches', () => {
    const casters = new SchemaCasters(buildCasters());

    expect(() => casters.getSchemaCaster('V1', 'V2', 'unknownTopic')).toThrow('unknownTopic');
  });

  it('SchemaCasterBuilder_BuiltCaster_CastsPayloads', () => {
    const casters = new SchemaCasters(buildCasters());

    const caster = casters.getSchemaCaster('V1', 'V2', 'orderCreated') as ISchemaCasterOf<V1OrderPayload, V2OrderPayload>;

    const v1 = new V1OrderPayload();
    v1.id = 'order-1';
    v1.quantity = 5;
    const result = caster.caster.cast(v1);

    expect(result.id).toBe('order-1');
    expect(result.quantity).toBe(5);
  });

  it('SchemaCaster_CastNonGeneric_InvokesTheTypedCaster', () => {
    const caster = new SchemaCasters(buildCasters()).getSchemaCaster('V1', 'V2', 'orderCreated');

    const v1 = new V1OrderPayload();
    v1.id = 'order-1';
    v1.quantity = 5;
    const result = caster.cast(v1) as V2OrderPayload;

    expect(result.id).toBe('order-1');
    expect(result.quantity).toBe(5);
  });

  it('TryGetSchemaCaster_ByFromSchemaAndToType_FindsTheRequestUpcastCaster', () => {
    const casters = new SchemaCasters(buildCasters());

    const caster = casters.tryGetSchemaCaster('orderCreated', 'V1', V2OrderPayload);

    expect(caster).toBeDefined();
    expect(caster!.fromType).toBe(V1OrderPayload);
    expect(caster!.toType).toBe(V2OrderPayload);
  });

  it('TryGetSchemaCaster_ByFromTypeAndToSchema_FindsTheResponseDowncastCaster', () => {
    const casters = new SchemaCasters(buildCasters());

    const caster = casters.tryGetSchemaCaster('orderCreated', V2OrderPayload, 'V1');

    expect(caster).toBeDefined();
    expect(caster!.fromType).toBe(V2OrderPayload);
    expect(caster!.toType).toBe(V1OrderPayload);
  });

  it('TryGetSchemaCaster_NoMatch_ReturnsUndefined', () => {
    const casters = new SchemaCasters(buildCasters());

    expect(casters.tryGetSchemaCaster('orderCreated', 'V9', V2OrderPayload)).toBeUndefined();
    expect(casters.tryGetSchemaCaster('otherTopic', 'V1', V2OrderPayload)).toBeUndefined();
    expect(casters.tryGetSchemaCaster('orderCreated', V2OrderPayload, 'V9')).toBeUndefined();
  });
});
