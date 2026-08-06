/**
 * Benzene validation integration adapting **ajv** — the standard JavaScript JSON Schema validator.
 *
 * Port of Benzene.JsonSchema. Where the .NET package validates against `JsonSchema.Net`, this validates
 * against ajv; `registerJsonSchema(RequestType, schema)` associates a hand-authored JSON Schema with a
 * request class, `useAjvValidation(router)` wires the handler-pipeline middleware + status mapper +
 * spec/mesh JSON-Schema source. It sits alongside `@benzene/zod` / `@benzene/joi` / `@benzene/yup` as the
 * raw-JSON-Schema member of the validation-adapter family — reach for it to validate against an
 * externally-authored or shared JSON Schema contract rather than a code-first schema object.
 *
 * TWO DIVERGENCES from `Benzene.JsonSchema` (both documented in the README porting-conventions table):
 * 1. **Handler-level, not raw-body.** C#'s `JsonSchemaMiddleware` is a transport pipeline middleware that
 *    evaluates the raw request *body* pre-deserialization (with `MissingBody`/`MalformedBody` results). The
 *    TypeScript port has no raw-body validation seam; validation is handler-level (on the deserialized
 *    `context.request`, via `IValidationStatusMapper`), so this mirrors the Zod/Joi/Yup adapters instead.
 * 2. **No generate-from-type.** C#'s `DefaultJsonSchemaProvider` *generates* a schema by reflecting over
 *    the request CLR type; TypeScript erases types at runtime, so there is nothing to reflect. Schemas are
 *    supplied explicitly via `registerJsonSchema` (the counterpart of `SuppliedJsonSchemaCatalog` /
 *    `AddSuppliedJsonSchemas`); a request type with no registered schema is not validated.
 */
export * from './AjvSchemaRegistry';
export * from './JsonSchemaValidationErrors';
export * from './AjvJsonSchemaSource';
export * from './ValidationMiddleware';
export * from './ValidationMiddlewareBuilder';
export * from './ValidationClientMiddleware';
export * from './ValidationClientMiddlewareBuilder';
export * from './DependencyExtensions';
