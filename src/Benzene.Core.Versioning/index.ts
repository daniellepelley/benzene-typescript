/**
 * Port of Benzene.Core.Versioning - transparent payload version-casting: upcast an older-version request
 * into the handler's declared type and downcast the response back to the requested version, composing
 * multi-step chains (V1 -> V2 -> V3) via BFS. Wire it with `usePayloadVersionCasting` +
 * `registerSchemaCastDefinitions`/`registerPayloadSchemaVersions`.
 *
 * DIVERGENCE: C#'s default caster is a reflection + `System.Linq.Expressions` auto-mapper
 * (`CasterFactory`/`CasterFuncBuilder`/`SchemaTypeMatcher`) that maps properties by name at runtime. That
 * has no faithful TypeScript equivalent (no runtime property reflection, no IL compilation, no assembly
 * scanning), so it is NOT ported - casters are supplied as explicit `(from) => to` functions (idiomatic
 * TS anyway). Runtime `Type` keys become `Constructor` keys throughout.
 */
export * from './Casters/ICaster';
export * from './Casters/FuncCaster';
export * from './Casters/CompositeCaster';
export * from './Schemas/SchemaCastDefinition';
export * from './Schemas/PayloadSchemaVersions';
export * from './Schemas/ISchemaCaster';
export * from './Schemas/SchemaCaster';
export * from './Schemas/ISchemaCasters';
export * from './Schemas/SchemaCasters';
export * from './Schemas/SchemaCasterBuilder';
export * from './Schemas/SchemaCastersBuilder';
export * from './Schemas/SchemaCastDefinitionsExpander';
export * from './Schemas/SchemaCasterExtensions';
export * from './Request/CastingRequestMapper';
export * from './Response/ResponseTypeOverrideDefinition';
export * from './Response/CastMessageHandlerResult';
export * from './Response/CastingResponsePayloadMapper';
export * from './PayloadVersionCastingExtensions';
