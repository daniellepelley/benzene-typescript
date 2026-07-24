import { describe, expect, it } from 'vitest';
import {
  ISchemaCasterOf,
  PayloadSchemaVersions,
  SchemaCastDefinitionsExpander,
  SchemaCasters,
  SchemaCastersBuilder,
} from '@benzene/core-versioning';
import {
  V1OrderPayload,
  V2OrderPayload,
  V3OrderPayload,
  V4OrderPayload,
  V5OrderPayload,
} from './exampleSchemas';

/**
 * Port of test/Benzene.Core.Test/Core/Versioning/SchemaCastDefinitionsExpanderTest.cs. C#'s
 * `RegisterInitValue(o => o.Currency, "USD")` auto-mapper config becomes an explicit cast function that
 * copies the carried-through fields and sets the init value; all other fields propagate because each
 * cast copies them.
 */

// Casts copy id/quantity (and downstream carry currency/reference/route) so the composed result reflects
// every step, exactly as the C# auto-mapped chain did.
const v1ToV2Currency = (f: V1OrderPayload): V2OrderPayload => {
  const t = new V2OrderPayload();
  t.id = f.id;
  t.quantity = f.quantity;
  t.currency = 'USD';
  return t;
};

const v2ToV3Reference = (f: V2OrderPayload): V3OrderPayload => {
  const t = new V3OrderPayload();
  t.id = f.id;
  t.quantity = f.quantity;
  t.currency = f.currency;
  t.reference = 'migrated';
  return t;
};

const v3ToV2 = (f: V3OrderPayload): V2OrderPayload => {
  const t = new V2OrderPayload();
  t.id = f.id;
  t.quantity = f.quantity;
  t.currency = f.currency;
  return t;
};

const v2ToV1 = (f: V2OrderPayload): V1OrderPayload => {
  const t = new V1OrderPayload();
  t.id = f.id;
  t.quantity = f.quantity;
  return t;
};

describe('SchemaCastDefinitionsExpander', () => {
  it('Expand_ComposesUpcastChainWhenNoDirectCasterExists', () => {
    const casters = new SchemaCastersBuilder()
      .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'orderCreated', 'V1', 'V2', v1ToV2Currency)
      .add<V2OrderPayload, V3OrderPayload>(V2OrderPayload, V3OrderPayload, 'orderCreated', 'V2', 'V3', v2ToV3Reference)
      .build();

    const versions: PayloadSchemaVersions = {
      topic: 'orderCreated',
      fromSchemas: ['V1', 'V2', 'V3'],
      toSchemas: ['V3'],
    };

    const expanded = new SchemaCastDefinitionsExpander().expand(casters, [versions]);

    expect(expanded).toHaveLength(2);

    const composite = new SchemaCasters(expanded).getSchemaCaster('V1', 'V3', 'orderCreated') as ISchemaCasterOf<
      V1OrderPayload,
      V3OrderPayload
    >;

    const v1 = new V1OrderPayload();
    v1.id = 'order-1';
    v1.quantity = 5;
    const result = composite.caster.cast(v1);

    expect(result.id).toBe('order-1');
    expect(result.quantity).toBe(5);
    expect(result.currency).toBe('USD');
    expect(result.reference).toBe('migrated');
  });

  it('Expand_ComposesDowncastChain', () => {
    const casters = new SchemaCastersBuilder()
      .add<V3OrderPayload, V2OrderPayload>(V3OrderPayload, V2OrderPayload, 'orderCreated', 'V3', 'V2', v3ToV2)
      .add<V2OrderPayload, V1OrderPayload>(V2OrderPayload, V1OrderPayload, 'orderCreated', 'V2', 'V1', v2ToV1)
      .build();

    const versions: PayloadSchemaVersions = { topic: 'orderCreated', fromSchemas: ['V3'], toSchemas: ['V1'] };

    const expanded = new SchemaCastDefinitionsExpander().expand(casters, [versions]);
    expect(expanded).toHaveLength(1);

    const composite = expanded[0] as ISchemaCasterOf<V3OrderPayload, V1OrderPayload>;
    const v3 = new V3OrderPayload();
    v3.id = 'order-3';
    v3.quantity = 2;
    v3.currency = 'EUR';
    const result = composite.caster.cast(v3);

    expect(result.id).toBe('order-3');
    expect(result.quantity).toBe(2);
  });

  it('Expand_ReusesDirectCasterWhenOneExists', () => {
    const casters = new SchemaCastersBuilder()
      .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'orderCreated', 'V1', 'V2', v1ToV2Currency)
      .build();

    const versions: PayloadSchemaVersions = { topic: 'orderCreated', fromSchemas: ['V1'], toSchemas: ['V2'] };

    const expanded = new SchemaCastDefinitionsExpander().expand(casters, [versions]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toBe(casters[0]);
  });

  it('Expand_ThrowsWhenNoCastingPathExists', () => {
    const casters = new SchemaCastersBuilder()
      .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'orderCreated', 'V1', 'V2', v1ToV2Currency)
      .build();

    const versions: PayloadSchemaVersions = { topic: 'orderCreated', fromSchemas: ['V3'], toSchemas: ['V1'] };

    expect(() => new SchemaCastDefinitionsExpander().expand(casters, [versions])).toThrow('No conversion path found');
  });

  it('Expand_PrefersShortcutCasterOverLongerChain', () => {
    const v2ToV3Longer = (f: V2OrderPayload): V3OrderPayload => {
      const t = new V3OrderPayload();
      t.id = f.id;
      t.quantity = f.quantity;
      t.route = 'via-v2-longer-chain';
      return t;
    };
    const v1ToV3Shortcut = (f: V1OrderPayload): V3OrderPayload => {
      const t = new V3OrderPayload();
      t.id = f.id;
      t.quantity = f.quantity;
      t.route = 'via-v1-v3-shortcut';
      return t;
    };
    const copyV3ToV4 = (f: V3OrderPayload): V4OrderPayload => ({ ...new V4OrderPayload(), ...f } as V4OrderPayload);
    const copyV4ToV5 = (f: V4OrderPayload): V5OrderPayload => ({ ...new V5OrderPayload(), ...f } as V5OrderPayload);

    const casters = new SchemaCastersBuilder()
      .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'orderCreated', 'V1', 'V2', (f) => {
        const t = new V2OrderPayload();
        t.id = f.id;
        t.quantity = f.quantity;
        return t;
      })
      .add<V2OrderPayload, V3OrderPayload>(V2OrderPayload, V3OrderPayload, 'orderCreated', 'V2', 'V3', v2ToV3Longer)
      .add<V1OrderPayload, V3OrderPayload>(V1OrderPayload, V3OrderPayload, 'orderCreated', 'V1', 'V3', v1ToV3Shortcut)
      .add<V3OrderPayload, V4OrderPayload>(V3OrderPayload, V4OrderPayload, 'orderCreated', 'V3', 'V4', copyV3ToV4)
      .add<V4OrderPayload, V5OrderPayload>(V4OrderPayload, V5OrderPayload, 'orderCreated', 'V4', 'V5', copyV4ToV5)
      .build();

    const versions: PayloadSchemaVersions = { topic: 'orderCreated', fromSchemas: ['V1'], toSchemas: ['V5'] };

    const expanded = new SchemaCastDefinitionsExpander().expand(casters, [versions]);
    expect(expanded).toHaveLength(1);

    const composite = expanded[0] as ISchemaCasterOf<V1OrderPayload, V5OrderPayload>;
    const v1 = new V1OrderPayload();
    v1.id = 'order-1';
    v1.quantity = 5;
    const result = composite.caster.cast(v1);

    expect(result.id).toBe('order-1');
    expect(result.quantity).toBe(5);
    expect(result.route).toBe('via-v1-v3-shortcut');
  });

  it('Expand_IgnoresCastersRegisteredForOtherTopics', () => {
    const casters = new SchemaCastersBuilder()
      .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'otherTopic', 'V1', 'V2', v1ToV2Currency)
      .build();

    const versions: PayloadSchemaVersions = { topic: 'orderCreated', fromSchemas: ['V1'], toSchemas: ['V2'] };

    expect(() => new SchemaCastDefinitionsExpander().expand(casters, [versions])).toThrow();
  });
});
