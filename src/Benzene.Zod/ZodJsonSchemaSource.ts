import { Constructor } from '@benzenejs/abstractions';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { getZodSchema } from './ZodSchemaRegistry';
import { zodToJsonSchema } from './zodToJsonSchema';

/**
 * An `ITypeJsonSchemaSource` backed by the registered Zod schemas: for a request/response type, it returns
 * the JSON Schema derived from that type's Zod schema (`ZodSchemaRegistry` → `zodToJsonSchema`), or
 * `undefined` when no Zod schema is registered for the type. This is what feeds a topic's payload schema
 * into the spec/mesh descriptor when a service validates with Zod — the runtime replacement for .NET
 * reflecting over the CLR type. Registered by `useZodValidation`.
 */
export class ZodJsonSchemaSource implements ITypeJsonSchemaSource {
  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined {
    const schema = getZodSchema(type);
    return schema === undefined ? undefined : zodToJsonSchema(schema);
  }
}
