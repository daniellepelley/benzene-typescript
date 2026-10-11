import { Constructor } from '@benzenejs/abstractions';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { globalRegistry } from 'zod';
import { getZodSchema } from './ZodSchemaRegistry';
import { zodToJsonSchema } from './zodToJsonSchema';

/**
 * An `ITypeJsonSchemaSource` backed by the registered Zod schemas: for a request/response type, it returns
 * the JSON Schema derived from that type's Zod schema (`ZodSchemaRegistry` → `zodToJsonSchema`), or
 * `undefined` when no Zod schema is registered for the type. This is what feeds a topic's payload schema
 * into the Contract Document when a service validates with Zod — the runtime replacement for .NET
 * reflecting over the CLR type. Registered by `useZodValidation`.
 */
export class ZodJsonSchemaSource implements ITypeJsonSchemaSource {
  getJsonSchema(type: Constructor<unknown>): Record<string, unknown> | undefined {
    const schema = getZodSchema(type);
    return schema === undefined ? undefined : zodToJsonSchema(schema);
  }

  /** The schema's declared name: its Zod `.meta({ id })` (contract-document.md §4.1 rule 5). */
  getSchemaName(type: Constructor<unknown>): string | undefined {
    const schema = getZodSchema(type);
    const id = schema === undefined ? undefined : globalRegistry.get(schema)?.id;
    return typeof id === 'string' && id !== '' ? id : undefined;
  }
}
