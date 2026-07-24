/**
 * Example payload schemas used by the versioning/casting tests, ported from
 * test/Benzene.Core.Test/Core/Versioning/ExampleSchemas.cs. Each version is a distinct class (so the
 * `SchemaCasters` maps key them by constructor identity). Because the reflection-based auto-mapper is
 * not ported, the tests supply explicit `(from) => to` cast functions rather than relying on
 * property-name auto-mapping, so these classes only carry the fields those casts and assertions use.
 */

export class V1OrderPayload {
  id: string | undefined;
  quantity = 0;
  customerName: string | undefined;
}

export class V2OrderPayload {
  id: string | undefined;
  quantity = 0;
  currency: string | undefined;
}

export class V3OrderPayload {
  id: string | undefined;
  quantity = 0;
  currency: string | undefined;
  reference: string | undefined;
  route: string | undefined;
}

export class V4OrderPayload {
  id: string | undefined;
  quantity = 0;
  currency: string | undefined;
  reference: string | undefined;
  route: string | undefined;
}

export class V5OrderPayload {
  id: string | undefined;
  quantity = 0;
  currency: string | undefined;
  reference: string | undefined;
  route: string | undefined;
}
