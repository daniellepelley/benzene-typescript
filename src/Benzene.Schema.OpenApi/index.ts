/**
 * Port of Benzene.Schema.OpenApi — the `benzene` spec document (`{ requests, events, transports?,
 * components.schemas }`) a Cloud Service serves on the reserved `spec` topic. Each topic carries its
 * request/response (or message) payload as a JSON Schema `$ref` into the shared `components.schemas`
 * catalogue.
 *
 * Divergence from the C# original: where `Benzene.Schema.OpenApi` generates payload schemas by reflecting
 * over the CLR type (Swashbuckle) and enriches them with FluentValidation rules, TypeScript erases types, so
 * schemas are *sourced* from the registered `ITypeJsonSchemaSource`s — the Zod/Joi/Yup schemas the service
 * already validates with (shape + rules in one pass), or a `MapTypeJsonSchemaSource` for bring-your-own.
 * Not ported (yet): the `openapi`/`asyncapi` output formats, generated examples, schema-compatibility
 * checking, and the test-payloads handler.
 */
export * from './Constants';
export * from './ReservedTopics';
export * from './SpecRequest';
export * from './ISchemaBuilder';
export * from './SchemaBuilder';
export * from './SpecBuilder';
export * from './SpecCache';
export * from './SpecMessageHandler';
export * from './Extensions';
export * from './EventService/HttpMapping';
export * from './EventService/RequestResponse';
export * from './EventService/Event';
export * from './EventService/EventServiceDocument';
export * from './EventService/EventServiceDocumentBuilder';
