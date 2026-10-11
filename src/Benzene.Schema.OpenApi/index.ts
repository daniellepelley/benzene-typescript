/**
 * Port of Benzene.Schema.OpenApi — the spec document a Cloud Service serves on the reserved `benzene:spec` topic, in
 * three formats selected by the request's `type`: the default `benzene` Contract Document
 * (docs/specification/contract-document.md: `{ schemaDialect, service, contractHash, registrationHash,
 * requests, events, sends, components.schemas }`), and this port's extensions `openapi` (OpenAPI 3.0) and
 * `asyncapi` (AsyncAPI 3.0). Each topic carries its payload schemas as a `$ref` into the shared
 * `components.schemas` catalogue; both hashes come from `@benzenejs/codegen-core`.
 *
 * Divergence from the C# original: where `Benzene.Schema.OpenApi` generates payload schemas by reflecting
 * over the CLR type (Swashbuckle) and enriches them with FluentValidation rules, TypeScript erases types, so
 * schemas are *sourced* from the registered `ITypeJsonSchemaSource`s — the Zod/Joi/Yup schemas the service
 * already validates with (shape + rules in one pass), or a `MapTypeJsonSchemaSource` for bring-your-own. The
 * documents are always serialised as JSON (OpenAPI/AsyncAPI's universal interchange format); the C# YAML
 * output and the reflection-only extras (schema-compatibility checking, the test-payloads handler) are not
 * ported; examples are never synthesized (contract-document.md §2).
 */
export * from './Constants';
export * from './ReservedTopics';
export * from './SpecRequest';
export * from './ISchemaBuilder';
export * from './SchemaBuilder';
export * from './SpecBuilder';
export * from './SpecCache';
export * from './SpecMessageHandler';
export * from './ComponentNameCollisionError';
export * from './ContractDocumentStartUpCheck';
export * from './Extensions';
export * from './EventService/HttpMapping';
export * from './EventService/RequestResponse';
export * from './EventService/Event';
export * from './EventService/Send';
export * from './EventService/EventServiceDocument';
export * from './EventService/EventServiceDocumentBuilder';
export * from './OpenApi/OpenApiDocumentBuilder';
export * from './AsyncApi/AsyncApiSpecOptions';
export * from './AsyncApi/AsyncApiDocumentBuilder';
