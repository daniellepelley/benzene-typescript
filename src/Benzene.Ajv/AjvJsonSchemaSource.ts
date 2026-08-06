import { Constructor } from '@benzene/abstractions';
import { ITypeJsonSchemaSource } from '@benzene/abstractions-validation';
import { getRegisteredJsonSchema } from './AjvSchemaRegistry';

/**
 * An `ITypeJsonSchemaSource` backed by the registered JSON Schemas: for a request/response type, it returns
 * the schema registered for that type (or `undefined` when none is registered). This feeds a topic's
 * payload schema into the spec/mesh descriptor when a service validates with ajv — the runtime replacement
 * for .NET reflecting over the CLR type. Registered by `useAjvValidation`.
 *
 * Unlike the Zod adapter's source (which must convert a `ZodType` via `zodToJsonSchema`), the registered
 * schema is *already* a JSON Schema, so it is returned directly. The root `$schema` dialect marker is
 * stripped — these schemas embed as fragments inside a larger spec/descriptor document, not as standalone
 * documents (matching `zodToJsonSchema` and .NET's embedded `OpenApiSchema`, which carry none).
 */
export class AjvJsonSchemaSource implements ITypeJsonSchemaSource {
  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined {
    const schema = getRegisteredJsonSchema(type);
    // A boolean JSON Schema (`true`/`false`) has no fragment shape to embed; only object schemas apply.
    if (schema === undefined || typeof schema !== 'object') {
      return undefined;
    }
    const { $schema: _dialect, ...fragment } = schema as Record<string, unknown>;
    return fragment;
  }
}
