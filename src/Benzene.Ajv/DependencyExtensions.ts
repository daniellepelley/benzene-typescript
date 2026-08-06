import { tryAddSingleton } from '@benzene/abstractions';
import { IMessageRouterBuilder } from '@benzene/abstractions-message-handlers';
import {
  DefaultValidationStatusMapper,
  ITypeJsonSchemaSource,
  IValidationStatusMapper,
} from '@benzene/abstractions-validation';
import { ValidationMiddlewareBuilder } from './ValidationMiddlewareBuilder';
import { AjvJsonSchemaSource } from './AjvJsonSchemaSource';

export { registerJsonSchema } from './AjvSchemaRegistry';

/**
 * Adds JSON Schema (ajv) request validation to a message router.
 *
 * Port of Benzene.JsonSchema.Extensions.UseJsonSchema (a fluent C# extension method → a free function
 * taking the builder as its first argument, per the porting conventions), ADAPTED to ajv and mirroring the
 * Zod adapter's `useZodValidation`. Registers `DefaultValidationStatusMapper` as the
 * `IValidationStatusMapper` (via `tryAddSingleton`, the port of C# `TryAdd...`) and adds the
 * `ValidationMiddlewareBuilder` to the handler pipeline. Returns the builder for chaining.
 *
 * C#'s `AddJsonSchema` registers `DefaultJsonSchemaProvider`, which *generates* a schema by reflecting over
 * the request CLR type. TypeScript erases types at runtime, so there is nothing to reflect: the schema is
 * supplied explicitly via `registerJsonSchema(requestType, schema)` (the counterpart of
 * `AddSuppliedJsonSchemas` / `SuppliedJsonSchemaCatalog`), and this function only wires the middleware, the
 * status mapper, and the JSON-Schema source that publishes the registered schemas to the spec/mesh.
 */
export function useAjvValidation(builder: IMessageRouterBuilder): IMessageRouterBuilder {
  builder.register((container) => {
    tryAddSingleton(container, IValidationStatusMapper, DefaultValidationStatusMapper);
    // Publish the registered JSON Schemas as a JSON-Schema source so the topic's payload schema reaches the
    // spec / mesh descriptor (the runtime replacement for .NET reflecting over the CLR type), mirroring
    // useZodValidation.
    container.addSingletonInstance(ITypeJsonSchemaSource, new AjvJsonSchemaSource());
  });
  return builder.add(new ValidationMiddlewareBuilder());
}

/**
 * Client-side (outbound) counterpart of `useAjvValidation`.
 *
 * As with the Zod adapter, the port has no router surface that consumes an
 * `IBenzeneClientContextMiddlewareBuilder` yet, so `ValidationClientMiddlewareBuilder` is exported for
 * manual wiring; a `useAjvValidationClient` free function will be added here once a client router exposes an
 * `add`, mirroring `useAjvValidation`.
 */
export { ValidationClientMiddlewareBuilder } from './ValidationClientMiddlewareBuilder';
