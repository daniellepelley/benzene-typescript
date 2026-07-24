/**
 * Port of Benzene.SchemaRegistry.Core - the vendor-neutral schema-registry seam: register schemas under
 * subjects (`ISchemaRegistryClient` + `InMemorySchemaRegistryClient`), enforce evolution rules
 * (`SchemaCompatibilityMode` + `ISchemaCompatibilityChecker`/`TextualSchemaCompatibilityChecker`),
 * resolve a message class's schema (`ISchemaResolver`), and frame payloads with the Confluent wire
 * format (`ConfluentWireFormat` + `SchemaRegistrySerializer`, wired up at startup by `SchemaRegistrar`).
 */
export * from './SchemaFormat';
export * from './SchemaCompatibilityMode';
export * from './SchemaDefinition';
export * from './RegisteredSchema';
export * from './SchemaIncompatibleException';
export * from './ISchemaResolver';
export * from './ISchemaCompatibilityChecker';
export * from './ISchemaRegistryClient';
export * from './InMemorySchemaRegistryClient';
export * from './ConfluentWireFormat';
export * from './SchemaRegistrySerializer';
export * from './SchemaRegistrar';
export * from './Extensions';
